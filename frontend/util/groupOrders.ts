import { OrderAllResponse } from "@/types/order";

const groupOrders = (orders: OrderAllResponse) => {
  return orders.reduce<{
    pendingPacked: OrderAllResponse;
    dispatched: OrderAllResponse;
    pending: OrderAllResponse;
    packed: OrderAllResponse;
  }>(
    (acc, order) => {
      if (order.status === "DISPATCHED") {
        acc.dispatched.push(order);
      } else if (order.status == "PACKED") {
        acc.pendingPacked.push(order);
        acc.packed.push(order);
      } else if (order.status == "PENDING") {
        acc.pending.push(order);
        acc.pendingPacked.push(order);
      }

      return acc;
    },
    {
      pendingPacked: [],
      dispatched: [],
      pending: [],
      packed: [],
    },
  );
};

export default groupOrders;
