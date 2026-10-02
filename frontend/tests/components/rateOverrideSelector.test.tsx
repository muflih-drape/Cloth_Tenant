import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RateOverrideSelector from "@/app/(agent-order)/agent/order/new/[id]/[qr]/components/RateOverrideSelector";

type Props = React.ComponentProps<typeof RateOverrideSelector>;

/**
 * The selector is a controlled input owned by the preview page, so typing into
 * it only looks right when the harness holds the value the way the page does.
 */
function Harness({
    onChange,
    ...props
}: Omit<Props, "onChange"> & { onChange?: (rate: string) => void }) {
    const [rate, setRate] = useState(props.value);
    return (
        <RateOverrideSelector
            {...props}
            value={rate}
            onChange={(next) => {
                setRate(next);
                onChange?.(next);
            }}
        />
    );
}

function selector(props: Partial<Props> = {}) {
    const onChange = vi.fn();
    render(
        <Harness
            catalogRate="9.00"
            value="9.00"
            onChange={onChange}
            {...props}
        />,
    );
    return { onChange };
}

const rateInput = () =>
    screen.getByRole("spinbutton", {
        name: /rate per metre/i,
    }) as HTMLInputElement;

describe("RateOverrideSelector", () => {
    it("shows the catalogue rate and offers no reset while it is unchanged", () => {
        selector();

        expect(rateInput().value).toBe("9.00");
        expect(screen.getByText(/Catalogue ₹9.00\/m/)).toBeTruthy();
        expect(screen.queryByRole("button", { name: /catalogue rate/i })).toBeNull();
    });

    it("says a changed rate only applies to this order", () => {
        selector({ value: "8.00" });

        expect(screen.getByText(/price it for this customer only/i)).toBeTruthy();
    });

    it("marks the line as already carrying an agreed rate", () => {
        selector({ value: "8.00", isOverridden: true });

        expect(screen.getByText(/already priced at an agreed rate/i)).toBeTruthy();
    });

    it("reports a discount against the catalogue rate", () => {
        selector({ value: "8.00" });

        expect(screen.getByText(/−₹1.00 vs catalogue/)).toBeTruthy();
    });

    it("reports a premium against the catalogue rate", () => {
        selector({ value: "9.75" });

        expect(screen.getByText(/\+₹0.75 vs catalogue/)).toBeTruthy();
    });

    it("hands the typed rate back to the page", async () => {
        const { onChange } = selector();
        const user = userEvent.setup();

        await user.clear(rateInput());
        await user.type(rateInput(), "8.25");

        expect(onChange).toHaveBeenLastCalledWith("8.25");
        expect(rateInput().value).toBe("8.25");
    });

    it("resets to the catalogue rate on request", async () => {
        const { onChange } = selector({ value: "8.00" });
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: /catalogue rate/i }));

        expect(onChange).toHaveBeenCalledWith("9.00");
        expect(rateInput().value).toBe("9.00");
    });

    it("tells an agent a rate above the catalogue will be refused", () => {
        selector({ value: "12.00" });

        expect(
            screen.getByText(/cannot charge more than the catalogue rate/i),
        ).toBeTruthy();
    });

    it("lets an admin bill above the catalogue rate", () => {
        selector({ value: "12.00", canRaiseRate: true });

        expect(
            screen.queryByText(/cannot charge more than the catalogue rate/i),
        ).toBeNull();
    });
});
