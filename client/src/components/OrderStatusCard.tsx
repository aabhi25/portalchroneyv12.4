import { ChevronRight } from "lucide-react";

export interface NormalizedOrder {
  orderId: string;
  status: string;
  productName: string | null;
  productImageUrl: string | null;
  courier: string | null;
  trackingNumber: string | null;
  estimatedDelivery: string | null;
  amount: string | null;
  notes: string | null;
}

export function normalizeOrder(raw: unknown): NormalizedOrder {
  const r = raw as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v : null);
  return {
    orderId: str(r.orderId) ?? str(r.order_id) ?? "",
    status: str(r.status) ?? "confirmed",
    productName: str(r.product) ?? str(r.productName) ?? null,
    productImageUrl: str(r.productImageUrl) ?? null,
    courier: str(r.courier) ?? null,
    trackingNumber: str(r.trackingNumber) ?? str(r.tracking) ?? null,
    estimatedDelivery: str(r.estimatedDelivery) ?? str(r.estDelivery) ?? null,
    amount: r.amount != null ? String(r.amount) : null,
    notes: str(r.notes) ?? null,
  };
}

const STATUS_STEPS = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"];

export const STATUS_LABELS: Record<string, string> = {
  confirmed: "Confirmed",
  processing: "Processing",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered",
  return_requested: "Return Requested",
  cancelled: "Cancelled",
};

export function statusBadgeClass(status: string) {
  if (status === "cancelled") return "bg-red-100 text-red-600";
  if (status === "return_requested") return "bg-pink-100 text-pink-700";
  if (status === "delivered") return "bg-green-100 text-green-700";
  if (status === "out_for_delivery") return "bg-orange-100 text-orange-700";
  return "bg-blue-100 text-blue-700";
}

interface OrderStatusCardProps {
  order: NormalizedOrder;
  onSelect: (order: NormalizedOrder) => void;
}

export function OrderStatusCard({ order, onSelect }: OrderStatusCardProps) {
  const isCancelled = order.status === "cancelled";
  const isReturnRequested = order.status === "return_requested";
  const currentStep = STATUS_STEPS.indexOf(order.status);

  return (
    <div
      className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm text-xs cursor-pointer hover:shadow-md hover:border-gray-300 transition-all active:scale-[0.99]"
      onClick={() => onSelect(order)}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-gray-800 text-sm">{order.orderId}</span>
        <div className="flex items-center gap-1">
          <span className={`px-2 py-0.5 rounded-full font-medium text-xs ${statusBadgeClass(order.status)}`}>
            {STATUS_LABELS[order.status] || order.status}
          </span>
          <ChevronRight className="w-3 h-3 text-gray-400 flex-shrink-0" />
        </div>
      </div>

      {(order.productImageUrl || order.productName) && (
        <div className="flex items-center gap-2 mb-2">
          {order.productImageUrl && (
            <img
              src={order.productImageUrl}
              alt={order.productName || "Product"}
              className="w-12 h-12 rounded-lg object-cover flex-shrink-0 border border-gray-100"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          )}
          {order.productName && (
            <span className="text-gray-700 font-medium leading-tight">{order.productName}</span>
          )}
        </div>
      )}

      {!isCancelled && !isReturnRequested && (
        <div className="flex items-center gap-1 mb-2">
          {STATUS_STEPS.map((step, i) => (
            <div key={step} className="flex items-center gap-1 flex-1">
              <div
                className={`w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 ${
                  i <= currentStep ? "bg-green-500" : "bg-gray-200"
                }`}
              >
                {i <= currentStep && (
                  <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 20 20" fill="currentColor">
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                )}
              </div>
              {i < STATUS_STEPS.length - 1 && (
                <div className={`flex-1 h-0.5 ${i < currentStep ? "bg-green-500" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-1 text-gray-500">
        {order.courier && (
          <div>
            <span className="font-medium text-gray-700">Courier:</span> {order.courier}
          </div>
        )}
        {order.trackingNumber && (
          <div>
            <span className="font-medium text-gray-700">Tracking:</span> {order.trackingNumber}
          </div>
        )}
        {order.estimatedDelivery && !isCancelled && (
          <div className="col-span-2">
            <span className="font-medium text-gray-700">Est. Delivery:</span>{" "}
            {new Date(order.estimatedDelivery).toLocaleDateString("en-IN", {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
        )}
        {order.amount && (
          <div>
            <span className="font-medium text-gray-700">Amount:</span> {order.amount}
          </div>
        )}
      </div>
    </div>
  );
}
