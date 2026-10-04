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
      } else if (order.status === "PARTIALLY_DISPATCHED") {
        // Partly dispatched is neither finished nor untouched: the bundles that
        // have gone are gone, and the ones still sealed are still waiting. It
        // counts as dispatched for the "finished" list, because that is what the
        // list is for, and stays out of "still being worked" because no work
        // happens on a box that is already on a truck. Bundles still waiting to
        // go out are counted by the packing queue, not here.
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
