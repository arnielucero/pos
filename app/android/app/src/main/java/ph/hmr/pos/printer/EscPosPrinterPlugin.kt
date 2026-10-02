package ph.hmr.pos.printer

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothSocket
import android.os.Build
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.UUID
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledExecutorService
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Raw ESC/POS transport for receipt printers.
 *
 *  - Bluetooth Classic SPP (RFCOMM, UUID 00001101-0000-1000-8000-00805F9B34FB) to a paired printer
 *  - Raw TCP (default port 9100) for Wi-Fi / LAN printers
 *
 * All IO runs on a dedicated single-thread executor (never the main thread) and every
 * operation is bounded by a timeout enforced by a watchdog that closes the socket.
 * Failures are rejected with stable codes the TypeScript side maps to typed errors:
 * BLUETOOTH_DISABLED, PERMISSION_DENIED, NOT_CONNECTED, TIMEOUT, IO_ERROR (and UNSUPPORTED).
 */
@CapacitorPlugin(
    name = "EscPosPrinter",
    permissions = [
        Permission(
            alias = EscPosPrinterPlugin.BT_ALIAS,
            strings = ["android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN"],
        ),
    ],
)
class EscPosPrinterPlugin : Plugin() {
    companion object {
        const val BT_ALIAS = "bluetooth"
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        private const val DEFAULT_CONNECT_TIMEOUT_MS = 8000L
        private const val DEFAULT_WRITE_TIMEOUT_MS = 15000L
        private const val CHUNK_SIZE = 1024
    }

    private interface Connection : Closeable {
        val output: OutputStream
        val input: InputStream
        fun isOpen(): Boolean
    }

    private class BtConnection(private val socket: BluetoothSocket) : Connection {
        override val output: OutputStream = socket.outputStream
        override val input: InputStream = socket.inputStream
        override fun isOpen(): Boolean = socket.isConnected
        override fun close() = socket.close()
    }

    private class TcpConnection(private val socket: Socket) : Connection {
        override val output: OutputStream = socket.getOutputStream()
        override val input: InputStream = socket.getInputStream()
        override fun isOpen(): Boolean = socket.isConnected && !socket.isClosed
        override fun close() = socket.close()
    }

    private class CodedException(val code: String, message: String) : Exception(message)

    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "escpos-io").apply { isDaemon = true } }
    private val watchdog: ScheduledExecutorService = Executors.newSingleThreadScheduledExecutor { r ->
        Thread(r, "escpos-watchdog").apply { isDaemon = true }
    }

    @Volatile private var connection: Connection? = null
    /** Socket currently being connected (closed by the watchdog on timeout). */
    @Volatile private var pending: Closeable? = null

    // ---------------------------------------------------------------- helpers

    /** Runs [block] off the main thread; resolves/rejects [call] exactly once; enforces [timeoutMs]. */
    private fun runIo(call: PluginCall, timeoutMs: Long, block: () -> JSObject?) {
        val settled = AtomicBoolean(false)
        val timer = watchdog.schedule({
            if (settled.compareAndSet(false, true)) {
                closeQuietly(pending)
                pending = null
                dropConnection()
                call.reject("Printer operation timed out", "TIMEOUT")
            }
        }, timeoutMs, TimeUnit.MILLISECONDS)
        io.execute {
            try {
                val result = block()
                if (settled.compareAndSet(false, true)) {
                    timer.cancel(false)
                    if (result == null) call.resolve() else call.resolve(result)
                }
            } catch (e: Throwable) {
                if (settled.compareAndSet(false, true)) {
                    timer.cancel(false)
                    val (code, message) = classify(e)
                    call.reject(message, code)
                }
            }
        }
    }

    private fun classify(e: Throwable): Pair<String, String> = when (e) {
        is CodedException -> e.code to (e.message ?: e.code)
        is SecurityException -> "PERMISSION_DENIED" to "Bluetooth permission denied"
        is SocketTimeoutException -> "TIMEOUT" to "Printer did not respond in time"
        is IOException -> "IO_ERROR" to (e.message ?: "Printer IO error")
        else -> "IO_ERROR" to (e.message ?: "Printer error")
    }

    private fun closeQuietly(c: Closeable?) {
        try {
            c?.close()
        } catch (_: IOException) {
        }
    }

    private fun dropConnection() {
        closeQuietly(connection)
        connection = null
    }

    private fun hasBluetoothPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState(BT_ALIAS) == PermissionState.GRANTED

    /** Returns false (and asks the user) when runtime Bluetooth permissions are missing (Android 12+). */
    private fun ensureBluetoothPermission(call: PluginCall): Boolean {
        if (hasBluetoothPermission()) return true
        requestPermissionForAlias(BT_ALIAS, call, "bluetoothPermissionCallback")
        return false
    }

    @PermissionCallback
    private fun bluetoothPermissionCallback(call: PluginCall) {
        if (!hasBluetoothPermission()) {
            call.reject("Bluetooth permission denied", "PERMISSION_DENIED")
            return
        }
        when (call.methodName) {
            "listPairedDevices" -> doListPaired(call)
            "connectBluetooth" -> doConnectBluetooth(call)
            else -> call.reject("Unexpected permission callback", "IO_ERROR")
        }
    }

    private fun adapter(): BluetoothAdapter {
        val manager = context.getSystemService(BluetoothManager::class.java)
        val adapter = manager?.adapter ?: throw CodedException("UNSUPPORTED", "This device has no Bluetooth")
        if (!adapter.isEnabled) throw CodedException("BLUETOOTH_DISABLED", "Bluetooth is turned off")
        return adapter
    }

    // ---------------------------------------------------------------- API

    @PluginMethod
    fun listPairedDevices(call: PluginCall) {
        if (!ensureBluetoothPermission(call)) return
        doListPaired(call)
    }

    @SuppressLint("MissingPermission")
    private fun doListPaired(call: PluginCall) {
        runIo(call, 5000) {
            val devices = JSArray()
            for (d in adapter().bondedDevices) {
                devices.put(JSObject().put("name", d.name ?: "").put("address", d.address))
            }
            JSObject().put("devices", devices)
        }
    }

    @PluginMethod
    fun connectBluetooth(call: PluginCall) {
        if (call.getString("address").isNullOrBlank()) {
            call.reject("address is required", "IO_ERROR")
            return
        }
        if (!ensureBluetoothPermission(call)) return
        doConnectBluetooth(call)
    }

    @SuppressLint("MissingPermission")
    private fun doConnectBluetooth(call: PluginCall) {
        val address = call.getString("address") ?: ""
        val timeout = (call.getInt("timeoutMs") ?: DEFAULT_CONNECT_TIMEOUT_MS.toInt()).toLong()
        runIo(call, timeout) {
            val bt = adapter()
            if (!BluetoothAdapter.checkBluetoothAddress(address)) throw CodedException("IO_ERROR", "Invalid Bluetooth address")
            dropConnection()
            try {
                bt.cancelDiscovery() // discovery slows RFCOMM connects
            } catch (_: SecurityException) {
            }
            val device = bt.getRemoteDevice(address)
            val socket = try {
                device.createRfcommSocketToServiceRecord(SPP_UUID).also {
                    pending = it
                    it.connect()
                }
            } catch (first: IOException) {
                // Many low-cost printers only accept insecure RFCOMM.
                closeQuietly(pending)
                device.createInsecureRfcommSocketToServiceRecord(SPP_UUID).also {
                    pending = it
                    it.connect()
                }
            }
            pending = null
            connection = BtConnection(socket)
            null
        }
    }

    @PluginMethod
    fun connectTcp(call: PluginCall) {
        val host = call.getString("host")
        if (host.isNullOrBlank()) {
            call.reject("host is required", "IO_ERROR")
            return
        }
        val port = call.getInt("port") ?: 9100
        val timeout = call.getInt("timeoutMs") ?: 5000
        runIo(call, timeout.toLong() + 1000) {
            dropConnection()
            val socket = Socket()
            pending = socket
            socket.connect(InetSocketAddress(host, port), timeout)
            socket.tcpNoDelay = true
            socket.soTimeout = 5000
            pending = null
            connection = TcpConnection(socket)
            null
        }
    }

    @PluginMethod
    fun write(call: PluginCall) {
        val data = call.getString("data")
        if (data == null) {
            call.reject("data is required", "IO_ERROR")
            return
        }
        val bytes = try {
            Base64.decode(data, Base64.DEFAULT)
        } catch (e: IllegalArgumentException) {
            call.reject("data is not valid base64", "IO_ERROR")
            return
        }
        runIo(call, DEFAULT_WRITE_TIMEOUT_MS) {
            val c = connection?.takeIf { it.isOpen() } ?: throw CodedException("NOT_CONNECTED", "Printer is not connected")
            try {
                var offset = 0
                while (offset < bytes.size) {
                    val len = minOf(CHUNK_SIZE, bytes.size - offset)
                    c.output.write(bytes, offset, len)
                    c.output.flush()
                    offset += len
                }
            } catch (e: IOException) {
                dropConnection()
                throw e
            }
            null
        }
    }

    /** DLE EOT n real-time status. Resolves {status: byte} or {status: -1} if the printer stays silent. */
    @PluginMethod
    fun queryStatus(call: PluginCall) {
        val n = call.getInt("n") ?: 4
        val timeout = (call.getInt("timeoutMs") ?: 800).toLong()
        runIo(call, timeout + 2000) {
            val c = connection?.takeIf { it.isOpen() } ?: throw CodedException("NOT_CONNECTED", "Printer is not connected")
            while (c.input.available() > 0) c.input.read() // drain stale bytes
            c.output.write(byteArrayOf(0x10, 0x04, n.toByte()))
            c.output.flush()
            val deadline = System.currentTimeMillis() + timeout
            var status = -1
            while (System.currentTimeMillis() < deadline) {
                if (c.input.available() > 0) {
                    status = c.input.read()
                    break
                }
                Thread.sleep(20)
            }
            JSObject().put("status", status)
        }
    }

    @PluginMethod
    fun disconnect(call: PluginCall) {
        runIo(call, 3000) {
            dropConnection()
            null
        }
    }

    @PluginMethod
    fun isConnected(call: PluginCall) {
        call.resolve(JSObject().put("connected", connection?.isOpen() == true))
    }

    override fun handleOnDestroy() {
        dropConnection()
        io.shutdownNow()
        watchdog.shutdownNow()
        super.handleOnDestroy()
    }
}
