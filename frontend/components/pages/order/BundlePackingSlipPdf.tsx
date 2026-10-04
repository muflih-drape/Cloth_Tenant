"use client";

import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";

import type { PackingBundle } from "@/types/order";

/**
 * The sheet that goes into the box.
 *
 * A sealed bundle cannot change, so this document is a record of what was in it:
 * who it is for, which order and bundle it came from, when it was closed, and every
 * roll in it with the length on that roll. The money is here too -- the unit rate
 * and the value per roll -- because the same figure already appears on the fabric's
 * own QR label, and the rate is the one snapshotted onto the order line, so the slip
 * can be checked against the invoice.
 *
 * Built with `@react-pdf/renderer`, like `QRLabelPdf`, so both documents go through
 * the same render-then-blob path and print the same way.
 */
interface BundlePackingSlipPdfProps {
  bundle: PackingBundle;
}

const styles = StyleSheet.create({
  page: {
    padding: 28,
    fontSize: 9,
    color: "#111827",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#111827",
  },
  title: {
    fontSize: 17,
    fontWeight: 800,
  },
  subtitle: {
    fontSize: 9,
    marginTop: 3,
    color: "#4b5563",
  },
  sealBadge: {
    fontSize: 10,
    fontWeight: 700,
    textAlign: "right",
  },
  sealedAt: {
    fontSize: 9,
    marginTop: 3,
    color: "#4b5563",
    textAlign: "right",
  },
  party: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 12,
    padding: 10,
    backgroundColor: "#f9fafb",
  },
  partyBlock: {
    width: "48%",
  },
  label: {
    fontSize: 7,
    letterSpacing: 0.6,
    color: "#6b7280",
    marginBottom: 2,
  },
  value: {
    fontSize: 10,
    fontWeight: 700,
  },
  address: {
    marginTop: 2,
    fontSize: 9,
    color: "#374151",
  },
  table: {
    marginTop: 14,
  },
  tableHead: {
    flexDirection: "row",
    backgroundColor: "#111827",
    paddingVertical: 5,
    paddingHorizontal: 6,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 5,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: "#e5e7eb",
  },
  th: {
    fontSize: 7.5,
    fontWeight: 700,
    color: "#ffffff",
    letterSpacing: 0.4,
  },
  cell: {
    fontSize: 9,
  },
  cellMuted: {
    fontSize: 8,
    color: "#6b7280",
  },
  cellRight: {
    fontSize: 9,
    textAlign: "right",
  },
  colRoll: { width: "15%" },
  colFabric: { width: "31%" },
  colColour: { width: "19%" },
  colMetres: { width: "11%" },
  colRate: { width: "12%" },
  colValue: { width: "12%" },
  totals: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "#111827",
  },
  totalBox: {
    width: "42%",
  },
  totalLine: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalLabel: {
    fontSize: 9,
    color: "#4b5563",
  },
  totalValue: {
    fontSize: 9,
    fontWeight: 600,
  },
  grandTotal: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 4,
    marginTop: 2,
    borderTopWidth: 1,
    borderTopColor: "#9ca3af",
  },
  grandLabel: {
    fontSize: 10,
    fontWeight: 800,
  },
  grandValue: {
    fontSize: 10,
    fontWeight: 800,
  },
  footer: {
    marginTop: 16,
    fontSize: 7.5,
    color: "#6b7280",
    textAlign: "center",
  },
  empty: {
    marginTop: 14,
    fontSize: 9,
    color: "#6b7280",
  },
});

const rupees = (value: string | number) =>
  `Rs. ${Number(value).toFixed(2)}`;

const metres = (value: string) => `${Number(value).toFixed(3)} m`;

const dateOnly = (iso: string | null) =>
  iso ? iso.slice(0, 10) : "-";

export function BundlePackingSlipPdf({ bundle }: BundlePackingSlipPdfProps) {
  const rolls = bundle.rolls;

  return (
    <Document
      title={bundle.code}
      author="Stock Flow"
      subject={`Packing slip for ${bundle.customer}`}
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Packing Slip</Text>
            <Text style={styles.subtitle}>{bundle.code}</Text>
          </View>
          <View>
            <Text style={styles.sealBadge}>{bundle.status}</Text>
            <Text style={styles.sealedAt}>
              Sealed: {dateOnly(bundle.sealed_at)}
            </Text>
          </View>
        </View>

        <View style={styles.party}>
          <View style={styles.partyBlock}>
            <Text style={styles.label}>DELIVER TO</Text>
            <Text style={styles.value}>{bundle.customer}</Text>
            {bundle.customer_address ? (
              <Text style={styles.address}>{bundle.customer_address}</Text>
            ) : null}
          </View>
          <View style={styles.partyBlock}>
            <Text style={styles.label}>ORDER</Text>
            <Text style={styles.value}>
              Order #{bundle.order_number} — Bundle {bundle.number}
            </Text>
            <Text style={styles.address}>
              Packed: {dateOnly(bundle.created_at)}
            </Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.th, styles.colRoll]}>ROLL</Text>
            <Text style={[styles.th, styles.colFabric]}>FABRIC</Text>
            <Text style={[styles.th, styles.colColour]}>COLOUR</Text>
            <Text style={[styles.th, styles.colMetres, styles.cellRight]}>
              LENGTH
            </Text>
            <Text style={[styles.th, styles.colRate, styles.cellRight]}>
              RATE
            </Text>
            <Text style={[styles.th, styles.colValue, styles.cellRight]}>
              VALUE
            </Text>
          </View>

          {rolls.length === 0 ? (
            <Text style={styles.empty}>
              No rolls were packed into this bundle.
            </Text>
          ) : (
            rolls.map((roll) => (
              <View key={roll.id} style={styles.tableRow} wrap={false}>
                <Text style={[styles.cell, styles.colRoll]}>
                  {roll.roll_number}
                </Text>
                <Text style={[styles.cell, styles.colFabric]}>
                  {roll.fabric_name || roll.fabric}
                </Text>
                <Text style={[styles.cell, styles.colColour]}>
                  {roll.colour || "-"}
                </Text>
                <Text style={[styles.cell, styles.colMetres, styles.cellRight]}>
                  {metres(roll.metres)}
                </Text>
                <Text style={[styles.cell, styles.colRate, styles.cellRight]}>
                  {rupees(roll.rate_per_meter)}
                </Text>
                <Text style={[styles.cell, styles.colValue, styles.cellRight]}>
                  {rupees(roll.value)}
                </Text>
              </View>
            ))
          )}
        </View>

        {rolls.length > 0 ? (
          <View style={styles.totals}>
            <View style={styles.totalBox}>
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Rolls</Text>
                <Text style={styles.totalValue}>{rolls.length}</Text>
              </View>
              <View style={styles.totalLine}>
                <Text style={styles.totalLabel}>Total length</Text>
                <Text style={styles.totalValue}>
                  {metres(bundle.total_metres)}
                </Text>
              </View>
              <View style={styles.grandTotal}>
                <Text style={styles.grandLabel}>Bundle total</Text>
                <Text style={styles.grandValue}>
                  {rupees(bundle.total_value)}
                </Text>
              </View>
            </View>
          </View>
        ) : null}

        <Text style={styles.footer}>
          Every roll listed above was cut whole and is recorded against this order.
          Check the contents against this slip before accepting the delivery.
        </Text>
      </Page>
    </Document>
  );
}