import { Network } from '@capacitor/network';
import type { ConnectivitySource } from './NetworkDetector';

export class CapacitorConnectivity implements ConnectivitySource {
  async isConnected(): Promise<boolean> {
    try {
      return (await Network.getStatus()).connected;
    } catch {
      return typeof navigator !== 'undefined' ? navigator.onLine : true;
    }
  }

  onChange(listener: (connected: boolean) => void): () => void {
    const handle = Network.addListener('networkStatusChange', (s) => {
      listener(s.connected);
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }
}
