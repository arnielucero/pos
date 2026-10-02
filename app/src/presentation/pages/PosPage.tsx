import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState, type KeyboardEvent } from 'react';
import type { CompleteSaleResult } from '../../application/usecases/CompleteSaleUseCase';
import type { Approval } from '../../domain/entities/Approval';
import type { ProductWithStock } from '../../domain/entities/Product';
import type { Discount, Payment } from '../../domain/entities/Sale';
import { PermissionPolicy } from '../../domain/services/PermissionPolicy';
import { CartPanel } from '../components/CartPanel';
import { PaymentDialog } from '../components/PaymentDialog';
import { ProductGrid } from '../components/ProductGrid';
import { SaleCompleteDialog } from '../components/SaleCompleteDialog';
import { useApproval } from '../hooks/ApprovalContext';
import { useContainer } from '../hooks/ContainerContext';
import { useDebouncedValue, useSession } from '../hooks/useAppState';
import { useCartTotals } from '../hooks/useCartTotals';
import { useCategories, useProductSearch } from '../hooks/useCatalog';
import { useCartStore } from '../stores/cartStore';
import { toUserMessage } from '../utils/errors';

const permissionPolicy = new PermissionPolicy();

export function PosPage() {
  const container = useContainer();
  const session = useSession();
  const withApproval = useApproval();
  const queryClient = useQueryClient();
  const [term, setTerm] = useState('');
  const [category, setCategory] = useState<string | null>(null);
  const debounced = useDebouncedValue(term, 200);
  const search = useProductSearch(debounced, category);
  const categories = useCategories();
  const cart = useCartStore();
  const totals = useCartTotals();
  const [payMethod, setPayMethod] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompleteSaleResult | null>(null);

  const addProduct = useCallback(
    (p: ProductWithStock) => {
      setError(null);
      cart.add(p);
    },
    [cart],
  );

  const onSearchKey = async (e: KeyboardEvent<HTMLInputElement>): Promise<void> => {
    if (e.key !== 'Enter') return;
    const p = await container.useCases.searchProducts.findByCode(term);
    if (p) {
      addProduct(p);
      setTerm('');
    } else if (search.items.length === 1 && search.items[0]) {
      addProduct(search.items[0]);
      setTerm('');
    }
  };

  /** Discounts need discount.apply — otherwise a manager approval obtained up-front. */
  const applyDiscount = async (target: { line: { productUuid: string } } | { order: true }, d: Discount | null): Promise<void> => {
    const apply = (approval: Approval | null): Promise<void> => {
      if (d && session.user) permissionPolicy.require(session.user, 'discount.apply', approval ?? cart.discountApproval);
      if ('order' in target) cart.setOrderDiscount(d, approval);
      else cart.setLineDiscount(target.line.productUuid, d, approval);
      return Promise.resolve();
    };
    try {
      await withApproval(apply, { reason: 'Discount' });
    } catch (e) {
      setError(toUserMessage(e));
    }
  };

  const checkout = async (payments: Payment[]): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await withApproval(
        (approval) =>
          container.useCases.completeSale.execute({
            lines: cart.lines.map((l) => ({ productUuid: l.productUuid, quantity: l.quantity, discount: l.discount })),
            orderDiscount: cart.orderDiscount,
            payments,
            approvals: { discount: cart.discountApproval, saleCreate: approval },
          }),
        { reason: 'Sale' },
      );
      if (res) {
        cart.clear();
        setPayMethod(null);
        setResult(res);
        void queryClient.invalidateQueries({ queryKey: ['products'] });
        void queryClient.invalidateQueries({ queryKey: ['sales'] });
      }
    } catch (e) {
      setError(toUserMessage(e));
      setPayMethod(null);
    } finally {
      setBusy(false);
    }
  };

  const loadMore = useCallback(() => {
    void search.fetchNextPage();
  }, [search]);

  return (
    <div className="pos">
      <section className="pos__catalog">
        <div className="pos__search">
          <input
            type="search"
            placeholder="Search name, SKU or scan barcode…"
            data-testid="product-search"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
            }}
            onKeyDown={(e) => void onSearchKey(e)}
          />
        </div>
        <div className="chips" role="tablist">
          <button
            type="button"
            className={`chip ${category === null ? 'chip--on' : ''}`}
            onClick={() => {
              setCategory(null);
            }}
          >
            All
          </button>
          {(categories.data ?? []).map((c) => (
            <button
              key={c}
              type="button"
              className={`chip ${category === c ? 'chip--on' : ''}`}
              onClick={() => {
                setCategory(c);
              }}
            >
              {c}
            </button>
          ))}
        </div>
        {search.isLoading ? (
          <div className="empty">Loading…</div>
        ) : (
          <ProductGrid
            items={search.items}
            hasMore={search.hasNextPage}
            loadingMore={search.isFetchingNextPage}
            onLoadMore={loadMore}
            onSelect={addProduct}
          />
        )}
      </section>
      <CartPanel
        methods={container.paymentMethods.list()}
        disabled={busy}
        onPay={(m) => {
          setError(null);
          setPayMethod(m);
        }}
        onDiscount={(t, d) => void applyDiscount(t, d)}
      />
      {error && (
        <div className="toast toast--error" role="alert" data-testid="pos-error">
          {error}
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => {
              setError(null);
            }}
          >
            ✕
          </button>
        </div>
      )}
      {payMethod && totals && (
        <PaymentDialog
          total={totals.total}
          initialMethod={payMethod}
          busy={busy}
          onCancel={() => {
            setPayMethod(null);
          }}
          onComplete={(p) => void checkout(p)}
        />
      )}
      {result && (
        <SaleCompleteDialog
          result={result}
          onClose={() => {
            setResult(null);
          }}
        />
      )}
    </div>
  );
}
