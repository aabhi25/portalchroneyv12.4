import { ArrowLeft, Package } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import type { NormalizedOrder } from "./OrderStatusCard";
import { STATUS_LABELS, statusBadgeClass } from "./OrderStatusCard";

const STATUS_STEPS = ["confirmed", "processing", "shipped", "out_for_delivery", "delivered"];
const STATUS_STEP_LABELS = ["Confirmed", "Processing", "Shipped", "Out for Delivery", "Delivered"];

interface OrderDetailOverlayProps {
  order: NormalizedOrder | null;
  onClose: () => void;
  chatColor?: string;
}

export function OrderDetailOverlay({
  order,
  onClose,
  chatColor = "#9333ea",
}: OrderDetailOverlayProps) {
  const isCancelled = order?.status === "cancelled";
  const isReturnRequested = order?.status === "return_requested";
  const currentStep = order ? STATUS_STEPS.indexOf(order.status) : -1;

  return (
    <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="!fixed !inset-0 !w-full !h-full !max-w-none !max-h-none !m-0 !p-0 !rounded-none !border-none !translate-x-0 !translate-y-0 !left-0 !top-0 bg-white flex flex-col overflow-hidden">
        {/* Sticky header */}
        <div className="flex-shrink-0 bg-white border-b border-gray-100 flex items-center gap-3 px-4 py-3">
          <button
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-gray-100 transition-colors flex-shrink-0"
            aria-label="Back"
          >
            <ArrowLeft className="w-5 h-5 text-gray-700" />
          </button>
          <span className="font-semibold text-gray-800 text-sm">Order Details</span>
        </div>

        {order && (
          <div className="flex-1 overflow-y-auto">
            {/* Product image */}
            {order.productImageUrl ? (
              <div className="w-full aspect-square bg-gray-50 overflow-hidden">
                <img
                  src={order.productImageUrl}
                  alt={order.productName || "Product"}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    const parent = (e.currentTarget as HTMLImageElement).parentElement;
                    if (parent) parent.style.display = "none";
                  }}
                />
              </div>
            ) : (
              <div className="w-full aspect-[4/3] bg-gradient-to-br from-gray-50 to-gray-100 flex items-center justify-center">
                <Package className="w-20 h-20 text-gray-300" />
              </div>
            )}

            <div className="px-4 py-4 space-y-4">
              {/* Product name */}
              {order.productName && (
                <p className="text-base font-semibold text-gray-900 leading-snug">
                  {order.productName}
                </p>
              )}

              {/* Order ID + status badge */}
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="font-bold text-gray-800 text-base">{order.orderId}</span>
                <span
                  className={`px-3 py-1 rounded-full font-semibold text-sm ${statusBadgeClass(order.status)}`}
                >
                  {STATUS_LABELS[order.status] || order.status}
                </span>
              </div>

              {/* Stepper or status banner */}
              {isCancelled ? (
                <div className="rounded-xl bg-red-50 border border-red-100 p-4 text-center">
                  <p className="text-red-700 font-semibold text-sm">This order has been cancelled.</p>
                  {order.notes && (
                    <p className="text-red-500 text-xs mt-1 leading-relaxed">{order.notes}</p>
                  )}
                </div>
              ) : isReturnRequested ? (
                <div className="rounded-xl bg-pink-50 border border-pink-100 p-4 text-center">
                  <p className="text-pink-700 font-semibold text-sm">Return / Exchange in progress.</p>
                  {order.notes && (
                    <p className="text-pink-500 text-xs mt-1 leading-relaxed">{order.notes}</p>
                  )}
                </div>
              ) : (
                <div className="pt-1">
                  {/* Dots + connectors */}
                  <div className="flex items-center">
                    {STATUS_STEPS.map((step, i) => (
                      <div key={step} className="flex items-center flex-1 last:flex-none">
                        <div
                          className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 ${
                            i <= currentStep ? "bg-green-500" : "bg-gray-200"
                          }`}
                        >
                          {i <= currentStep && (
                            <svg
                              className="w-3.5 h-3.5 text-white"
                              viewBox="0 0 20 20"
                              fill="currentColor"
                            >
                              <path
                                fillRule="evenodd"
                                d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                clipRule="evenodd"
                              />
                            </svg>
                          )}
                        </div>
                        {i < STATUS_STEPS.length - 1 && (
                          <div
                            className={`flex-1 h-0.5 ${
                              i < currentStep ? "bg-green-500" : "bg-gray-200"
                            }`}
                          />
                        )}
                      </div>
                    ))}
                  </div>
                  {/* Step labels */}
                  <div className="flex mt-1.5">
                    {STATUS_STEP_LABELS.map((label, i) => (
                      <div key={label} className="flex-1 text-center first:text-left last:text-right">
                        <span
                          className={`text-[10px] leading-tight block ${
                            i <= currentStep
                              ? "text-green-600 font-medium"
                              : "text-gray-400"
                          }`}
                        >
                          {label}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Details table */}
              <div className="rounded-xl bg-gray-50 divide-y divide-gray-100 overflow-hidden">
                {order.courier && (
                  <div className="flex justify-between items-center px-4 py-3 text-sm">
                    <span className="text-gray-500">Courier</span>
                    <span className="font-medium text-gray-800">{order.courier}</span>
                  </div>
                )}
                {order.trackingNumber && (
                  <div className="flex justify-between items-center px-4 py-3 text-sm">
                    <span className="text-gray-500">Tracking</span>
                    <span className="font-medium text-gray-800 font-mono text-xs">
                      {order.trackingNumber}
                    </span>
                  </div>
                )}
                {order.estimatedDelivery && !isCancelled && (
                  <div className="flex justify-between items-center px-4 py-3 text-sm">
                    <span className="text-gray-500">Est. Delivery</span>
                    <span className="font-medium text-gray-800">
                      {new Date(order.estimatedDelivery).toLocaleDateString("en-IN", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      })}
                    </span>
                  </div>
                )}
                {order.amount && (
                  <div className="flex justify-between items-center px-4 py-3 text-sm">
                    <span className="text-gray-500">Amount</span>
                    <span className="font-semibold" style={{ color: chatColor }}>
                      {order.amount}
                    </span>
                  </div>
                )}
              </div>

              {/* Notes block — only for non-cancelled, non-return orders */}
              {order.notes && !isCancelled && !isReturnRequested && (
                <div className="rounded-xl bg-amber-50 border border-amber-100 p-4">
                  <p className="text-xs font-semibold text-amber-700 mb-1">Note</p>
                  <p className="text-xs text-amber-600 leading-relaxed">{order.notes}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
