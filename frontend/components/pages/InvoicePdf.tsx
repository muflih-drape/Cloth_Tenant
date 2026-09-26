import {
    Document,
    Page,
    Text,
    View,
    StyleSheet,
    Image,
} from "@react-pdf/renderer";
import { InvoiceResponse } from "@/types/order";

const styles = StyleSheet.create({
    page: {
        padding: 36,
        fontSize: 10,
        fontFamily: "Helvetica",
        backgroundColor: "#ffffff",
    },

    // ── Brand Header ──
    headerRow: {
        flexDirection: "row",
        alignItems: "center",
        width: "100%",
        justifyContent: "space-between",
        marginBottom: 4,
    },

    logoBox: {
        width: 72,
        height: 72,
        borderRadius: 4,
        marginRight: 14,
        justifyContent: "center",
        alignItems: "center",
        // removed: overflow: "hidden" — not supported in react-pdf
    },

    logoImage: {
        width: 72,
        height: 72,
        borderRadius: 4,
    },

    logoFallbackText: {
        color: "#0f1f3d",
        fontSize: 22,
        fontFamily: "Helvetica-Bold",
    },

    brandInfo: {
        // removed: display: "flex" — redundant in react-pdf
        alignItems: "flex-end",
    },

    brandName: {
        fontSize: 13,
        fontFamily: "Helvetica-Bold",
        color: "#0f1f3d",
        letterSpacing: 0.5,
    },

    brandDetail: {
        fontSize: 8.5,
        color: "#444",
        textAlign: "right",
        marginTop: 2,
    },

    headerDivider: {
        borderBottomWidth: 2,
        borderColor: "#0f1f3d",
        marginBottom: 10,
    },

    // ── Order Form Title Row ──
    titleRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        alignItems: "flex-start",
        marginBottom: 12,
    },

    orderFormTitle: {
        fontSize: 20,
        fontFamily: "Helvetica-Bold",
        color: "#0f1f3d",
        letterSpacing: 1,
    },

    orderMeta: {
        alignItems: "flex-end",
    },

    orderMetaText: {
        fontSize: 9,
        color: "#333",
        marginBottom: 2,
    },

    orderMetaBold: {
        fontFamily: "Helvetica-Bold",
    },

    titleDivider: {
        borderBottomWidth: 1,
        borderColor: "#ccc",
        marginBottom: 12,
    },

    // ── Customer / Agent ──
    partiesRow: {
        flexDirection: "row",
        marginBottom: 14,
    },

    partyBox: {
        flex: 1,
        padding: 4,
    },

    partyDivider: {
        borderRightWidth: 1,
        borderColor: "#ddd",
    },

    partyBadge: {
        backgroundColor: "#0f1f3d",
        color: "#ffffff",
        fontSize: 8,
        fontFamily: "Helvetica-Bold",
        paddingHorizontal: 6,
        paddingVertical: 3, // added: prevents text from touching badge edges
        marginBottom: 6,
        alignSelf: "flex-start",
        letterSpacing: 0.8,
    },

    partyName: {
        fontSize: 12,
        fontFamily: "Helvetica-Bold",
        color: "#0f1f3d",
        marginBottom: 2,
    },

    partyDetail: {
        fontSize: 10,
        color: "#555",
        marginBottom: 1,
    },

    // ── Table ──
    table: {
        marginBottom: 16,
        borderWidth: 1,
        borderColor: "#0f1f3d",
    },

    tableHeader: {
        flexDirection: "row",
        backgroundColor: "#0f1f3d",
        paddingVertical: 7,
        paddingHorizontal: 6,
    },

    tableHeaderText: {
        color: "#ffffff",
        fontSize: 9,
        fontFamily: "Helvetica-Bold",
        textAlign: "center",
    },

    tableRow: {
        flexDirection: "row",
        borderBottomWidth: 0.5,
        borderBottomColor: "#ddd",
        borderBottomStyle: "dashed",
        paddingVertical: 7,
        paddingHorizontal: 6,
        alignItems: "center",
    },

    tableRowEven: {
        backgroundColor: "#f9f9f9",
    },

    colItem: { width: "30%", textAlign: "center" },
    colSize: { width: "22%", textAlign: "center" },
    colPrice: { width: "18%", textAlign: "center" },
    colQty: { width: "12%", textAlign: "center" },
    colAmount: { width: "18%", textAlign: "center" },

    cellText: {
        fontSize: 9.5,
        color: "#222",
        textAlign: "center",
    },

    cellSub: {
        fontSize: 7.5,
        color: "#888",
        textAlign: "center",
    },

    // ── Total Breakdown ──
    summaryRow: {
        flexDirection: "row",
        justifyContent: "space-between",
        marginBottom: 8,
    },

    totalPiecesRow: {
        flexDirection: "row",
        justifyContent: "flex-start",
        columnGap: 4,
    },

    totalPiecesLabel: {
        fontSize: 10,
        color: "#444",
        fontFamily: "Helvetica-Bold",
    },

    totalPiecesValue: {
        fontSize: 10,
        color: "#444",
        fontFamily: "Helvetica",
    },

    subtotalRow: {
        flexDirection: "row",
        justifyContent: "flex-end",
        alignItems: "center",
        marginBottom: 2,
    },

    subtotalLabel: {
        fontSize: 10,
        color: "#444",
        fontFamily: "Helvetica-Bold",
        paddingRight: 12,
        textAlign: "right",
        width: 80,
    },

    subtotalValueBox: {
        paddingVertical: 4,
        paddingHorizontal: 16,
        justifyContent: "center",
        alignItems: "center",
        minWidth: 90,
    },

    subtotalValueText: {
        fontSize: 10,
        fontFamily: "Helvetica",
        color: "#444",
    },

    totalRow: {
        flexDirection: "row",
        justifyContent: "flex-end",
        marginTop: 4,
    },

    totalBadge: {
        backgroundColor: "#0f1f3d",
        paddingVertical: 8,
        paddingHorizontal: 16,
        justifyContent: "center",
        alignItems: "center",
    },

    totalBadgeText: {
        color: "#ffffff",
        fontSize: 11,
        fontFamily: "Helvetica-Bold",
        letterSpacing: 1,
    },

    totalValueBox: {
        borderWidth: 1,
        borderColor: "#0f1f3d",
        paddingVertical: 8,
        paddingHorizontal: 20,
        justifyContent: "center",
        alignItems: "center",
        minWidth: 90,
    },

    totalValueText: {
        fontSize: 12,
        fontFamily: "Helvetica-Bold",
        color: "#0f1f3d",
    },

    // ── Footer ──
    footer: {
        marginTop: 30,
        alignItems: "center",
        flexDirection: "row",
        justifyContent: "center",
    },

    footerLine: {
        flex: 1,
        borderBottomWidth: 0.5,
        borderColor: "#aaa",
        marginHorizontal: 8,
        marginBottom: 3,
    },

    footerText: {
        fontSize: 9,
        color: "#666",
        fontFamily: "Helvetica-Oblique",
    },
});

// ── Helpers ─────────────────────────────────────
const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-IN", {
        day: "numeric",
        month: "numeric",
        year: "numeric",
    });

const formatTime = (iso: string) =>
    new Date(iso).toLocaleTimeString("en-IN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
    });

// ── Component ─────────────────────────────────────
export const InvoicePDF = ({ invoice }: { invoice: InvoiceResponse }) => {
    const brandName = invoice.brand?.name ?? invoice.items[0].item_type!;
    const address1 = invoice.brand?.address_line1 ?? "";
    const address2 = invoice.brand?.address_line2 ?? "";
    const phone = invoice.brand?.phone ?? "";
    const email = invoice.brand?.email ?? "";
    const gst = invoice.brand?.gst ?? "";
    const logoUrl = invoice.brand?.logo_url ?? null;

    const gstRate = invoice.gst_rate ?? 0;
    const gstAmount = invoice.total_price * (gstRate / 100);
    const totalWithGst = invoice.total_price + gstAmount;
    const totalPieces = invoice.items.reduce(
        (sum, item) => sum + item.quantity * (item.piece_count || 1),
        0,
    );

    return (
        <Document>
            <Page size="A4" style={styles.page}>
                {/* ── Brand Header ── */}
                <View style={styles.headerRow}>
                    <View style={styles.logoBox}>
                        {logoUrl ? (
                            <Image src={logoUrl} style={styles.logoImage} />
                        ) : (
                            <Text style={styles.logoFallbackText}>
                                {brandName.slice(0, 2).toUpperCase()}
                            </Text>
                        )}
                    </View>

                    <View style={styles.brandInfo}>
                        <Text style={styles.brandName}>{brandName}</Text>
                        <Text style={styles.brandDetail}>{address1}</Text>
                        <Text style={styles.brandDetail}>{address2}</Text>
                        <Text style={styles.brandDetail}>{phone}</Text>
                        <Text style={styles.brandDetail}>{email}</Text>
                        {gst && (
                            <Text style={styles.brandDetail}>GST : {gst}</Text>
                        )}
                    </View>
                </View>

                <View style={styles.headerDivider} />

                {/* ── Order Form Title ── */}
                <View style={styles.titleRow}>
                    <Text style={styles.orderFormTitle}>ORDER FORM</Text>
                    <View style={styles.orderMeta}>
                        <Text style={styles.orderMetaText}>
                            Order Form{" "}
                            <Text style={styles.orderMetaBold}>
                                #{String(invoice.id)}
                            </Text>
                        </Text>
                        <Text style={styles.orderMetaText}>
                            Date :{" "}
                            <Text style={styles.orderMetaBold}>
                                {formatDate(invoice.created_at)}
                            </Text>
                        </Text>
                        <Text style={styles.orderMetaText}>
                            Time :{" "}
                            <Text style={styles.orderMetaBold}>
                                {formatTime(invoice.created_at)}
                            </Text>
                        </Text>
                    </View>
                </View>

                {/* ── Customer & Agent ── */}
                <View style={styles.partiesRow}>
                    <View style={[styles.partyBox, styles.partyDivider]}>
                        <Text style={styles.partyBadge}>CUSTOMER:</Text>
                        <Text style={styles.partyName}>
                            {invoice.customer.name}
                        </Text>
                        {invoice.customer.address ? (
                            <Text style={styles.partyDetail}>
                                {invoice.customer.address}
                            </Text>
                        ) : null}
                        {invoice.customer.contact ? (
                            <Text style={styles.partyDetail}>
                                {invoice.customer.contact}
                            </Text>
                        ) : null}
                    </View>

                    <View style={styles.partyBox}>
                        <Text style={styles.partyBadge}>AGENT:</Text>
                        <Text style={styles.partyName}>
                            {invoice.agent.username}
                        </Text>
                        {invoice.agent.contact ? (
                            <Text style={styles.partyDetail}>
                                {invoice.agent.contact}
                            </Text>
                        ) : null}
                    </View>
                </View>

                {/* ── Items Table ── */}
                <View style={styles.table}>
                    <View style={styles.tableHeader}>
                        <Text style={[styles.tableHeaderText, styles.colItem]}>
                            Item
                        </Text>
                        <Text style={[styles.tableHeaderText, styles.colSize]}>
                            Size
                        </Text>
                        <Text style={[styles.tableHeaderText, styles.colPrice]}>
                            Price
                        </Text>
                        <Text style={[styles.tableHeaderText, styles.colQty]}>
                            Qty
                        </Text>
                        <Text
                            style={[styles.tableHeaderText, styles.colAmount]}
                        >
                            Amount
                        </Text>
                    </View>

                    {invoice.items.map((item, idx) => {
                        const pieceCount = item.piece_count || 1;
                        const totalPieces = item.quantity * pieceCount;
                        const itemPrice =
                            parseFloat(String(item.item_price)) || 0;
                        const amount = itemPrice * item.quantity * pieceCount;

                        return (
                            <View
                                key={item.id}
                                style={[
                                    styles.tableRow,
                                    idx % 2 === 1 ? styles.tableRowEven : {},
                                ]}
                            >
                                <View style={styles.colItem}>
                                    <Text style={styles.cellText}>
                                      {item.item_name}{item.variant_display_order ? ` ( ${item.variant_display_order})` : ""}
                                    </Text>
                                </View>

                                <Text style={[styles.cellText, styles.colSize]}>
                                    {item.size_group}
                                </Text>

                                <Text
                                    style={[styles.cellText, styles.colPrice]}
                                >
                                    Rs. {itemPrice.toFixed(2)}
                                </Text>

                                <View style={styles.colQty}>
                                    <Text style={styles.cellText}>
                                        {item.quantity}
                                    </Text>
                                    {pieceCount > 1 && (
                                        <Text style={styles.cellSub}>
                                            ×{pieceCount}={totalPieces}pc
                                        </Text>
                                    )}
                                </View>

                                <Text
                                    style={[styles.cellText, styles.colAmount]}
                                >
                                    Rs. {amount.toLocaleString("en-IN")}
                                </Text>
                            </View>
                        );
                    })}
                </View>

                <View style={styles.summaryRow}>
                    {/* ── Total Pieces ── */}
                    <View style={styles.totalPiecesRow}>
                        <Text style={styles.totalPiecesLabel}>
                            TOTAL PIECES:
                        </Text>
                        <Text style={styles.totalPiecesValue}>
                            {totalPieces}
                        </Text>
                    </View>

                    <View>
                        {/* ── Total Breakdown ── */}
                        <View style={styles.subtotalRow}>
                            <Text style={styles.subtotalLabel}>SUBTOTAL:</Text>
                            <View style={styles.subtotalValueBox}>
                                <Text style={styles.subtotalValueText}>
                                    Rs.{" "}
                                    {invoice.total_price.toLocaleString(
                                        "en-IN",
                                    )}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.subtotalRow}>
                            <Text style={styles.subtotalLabel}>
                                GST @ {gstRate}%:
                            </Text>
                            <View style={styles.subtotalValueBox}>
                                <Text style={styles.subtotalValueText}>
                                    Rs.{" "}
                                    {gstAmount.toLocaleString("en-IN", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}
                                </Text>
                            </View>
                        </View>
                        <View style={styles.totalRow}>
                            <View style={styles.totalBadge}>
                                <Text style={styles.totalBadgeText}>
                                    TOTAL:
                                </Text>
                            </View>
                            <View style={styles.totalValueBox}>
                                <Text style={styles.totalValueText}>
                                    Rs.{" "}
                                    {totalWithGst.toLocaleString("en-IN", {
                                        minimumFractionDigits: 2,
                                        maximumFractionDigits: 2,
                                    })}
                                </Text>
                            </View>
                        </View>
                    </View>
                </View>

                {/* ── Footer ── */}
                <View style={styles.footer}>
                    <View style={styles.footerLine} />
                    <Text style={styles.footerText}>
                        Thank you for your business!
                    </Text>
                    <View style={styles.footerLine} />
                </View>
            </Page>
        </Document>
    );
};
