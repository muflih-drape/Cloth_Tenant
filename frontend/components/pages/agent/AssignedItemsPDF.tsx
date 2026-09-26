import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";

export interface PDFVariant {
  variantId: number;
  itemName: string;
  itemType?: string;
  itemPrice: string;
  imageDataUrl: string | null;
  qrCode: string | null;
  sizes: { size: string; stock: number }[];
}

interface AssignedItemsPDFProps {
  variants: PDFVariant[];
  agentName: string;
  tabLabel: string;
  generatedAt: string;
}

const ACCENT = "#2563eb";
const LIGHT_BG = "#f8faff";

const variantPieces = (v: PDFVariant) =>
  v.sizes.reduce((s, sz) => s + sz.stock, 0);

const totalStock = (variants: PDFVariant[]) =>
  variants.reduce((sum, v) => sum + variantPieces(v), 0);

const styles = StyleSheet.create({
  page: {
    padding: 36,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
    backgroundColor: "#ffffff",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    paddingBottom: 14,
    borderBottomWidth: 2,
    borderBottomColor: ACCENT,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
    marginBottom: 4,
  },
  agentName: {
    fontSize: 12,
    fontFamily: "Helvetica-Bold",
    color: "#111",
    marginBottom: 2,
  },
  headerMeta: {
    fontSize: 9,
    color: "#888",
  },
  badge: {
    backgroundColor: LIGHT_BG,
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 4,
    paddingHorizontal: 10,
    paddingVertical: 4,
    alignSelf: "flex-start",
  },
  badgeText: {
    fontSize: 9,
    color: ACCENT,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  summaryBar: {
    flexDirection: "row",
    backgroundColor: LIGHT_BG,
    borderRadius: 6,
    padding: 10,
    marginBottom: 16,
  },
  summaryItem: {
    flex: 1,
    alignItems: "center",
  },
  summaryValue: {
    fontSize: 16,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
  },
  summaryLabel: {
    fontSize: 8,
    color: "#888",
    marginTop: 2,
    textTransform: "uppercase",
  },
  summaryDivider: {
    width: 1,
    backgroundColor: "#dde5f4",
  },
  table: {},
  tableHeader: {
    flexDirection: "row",
    backgroundColor: ACCENT,
    paddingVertical: 7,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginBottom: 2,
  },
  tableHeaderText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: "#fff",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 7,
    paddingHorizontal: 8,
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "#eef1f8",
  },
  tableRowAlt: {
    backgroundColor: LIGHT_BG,
  },
  colImage: { width: 44 },
  colName: { flex: 1, paddingRight: 8 },
  colType: { width: 56, paddingRight: 8 },
  colSizes: { width: 90, paddingRight: 8 },
  colPieces: { width: 40, alignItems: "flex-end", paddingRight: 4 },
  colPrice: { width: 70, alignItems: "flex-end" },
  itemImage: {
    width: 32,
    height: 32,
    borderRadius: 4,
  },
  imagePlaceholder: {
    width: 32,
    height: 32,
    backgroundColor: "#e5e7eb",
    borderRadius: 4,
  },
  nameText: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#111",
  },
  typeText: {
    fontSize: 9,
    color: "#666",
  },
  priceText: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#111",
  },
  sizesRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 3,
    marginTop: 3,
  },
  sizeChip: {
    backgroundColor: "#e8edf8",
    borderRadius: 3,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  sizeChipText: {
    fontSize: 7,
    color: "#444",
    fontFamily: "Helvetica-Bold",
  },
  piecesBadge: {
    backgroundColor: "#dbeafe",
    borderRadius: 3,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  piecesBadgeText: {
    fontSize: 8,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
  },
  footer: {
    marginTop: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "#dde5f4",
  },
  footerLeft: {
    fontSize: 8,
    color: "#aaa",
  },
  footerRight: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: ACCENT,
  },
});

export default function AssignedItemsPDF({
  variants,
  agentName,
  tabLabel,
  generatedAt,
}: AssignedItemsPDFProps) {
  const stock = totalStock(variants);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title}>Items Summary</Text>
            <Text style={styles.agentName}>{agentName}</Text>
            <Text style={styles.headerMeta}>Generated: {generatedAt}</Text>
          </View>
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{tabLabel}</Text>
          </View>
        </View>

        {/* Summary bar */}
        <View style={styles.summaryBar}>
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{variants.length}</Text>
            <Text style={styles.summaryLabel}>Colors</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>{stock}</Text>
            <Text style={styles.summaryLabel}>Total Pieces</Text>
          </View>
          <View style={styles.summaryDivider} />
          <View style={styles.summaryItem}>
            <Text style={styles.summaryValue}>
              {new Set(variants.map((v) => v.itemType || "—")).size}
            </Text>
            <Text style={styles.summaryLabel}>Types</Text>
          </View>
        </View>

        {/* Table */}
        <View style={styles.table}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.colImage]}> </Text>
            <Text style={[styles.tableHeaderText, styles.colName]}>Item</Text>
            <Text style={[styles.tableHeaderText, styles.colType]}>Type</Text>
            <Text style={[styles.tableHeaderText, styles.colSizes]}>Sizes</Text>
            <Text style={[styles.tableHeaderText, styles.colPieces]}>Pcs</Text>
            <Text style={[styles.tableHeaderText, styles.colPrice]}>Price</Text>
          </View>

          {variants.map((v, i) => (
            <View
              key={v.variantId ?? i}
              style={[styles.tableRow, i % 2 !== 0 ? styles.tableRowAlt : {}]}
            >
              <View style={styles.colImage}>
                {v.imageDataUrl ? (
                  <Image src={v.imageDataUrl} style={styles.itemImage} />
                ) : (
                  <View style={styles.imagePlaceholder} />
                )}
              </View>

              <View style={styles.colName}>
                <Text style={styles.nameText}>{v.itemName}</Text>
              </View>

              <View style={styles.colType}>
                <Text style={styles.typeText}>{v.itemType || "—"}</Text>
              </View>

              <View style={styles.colSizes}>
                {v.sizes.length > 0 ? (
                  <View style={styles.sizesRow}>
                    {v.sizes.map((s) => (
                      <View key={s.size} style={styles.sizeChip}>
                        <Text style={styles.sizeChipText}>
                          {s.size}: {s.stock}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : (
                  <Text style={styles.typeText}>—</Text>
                )}
              </View>

              <View style={styles.colPieces}>
                <View style={styles.piecesBadge}>
                  <Text style={styles.piecesBadgeText}>{variantPieces(v)}</Text>
                </View>
              </View>

              <View style={styles.colPrice}>
                <Text style={styles.priceText}>Rs. {v.itemPrice}</Text>
              </View>
            </View>
          ))}
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerLeft}>Assigned Items · {agentName}</Text>
          <Text style={styles.footerRight}>
            {variants.length} color
            {variants.length !== 1 ? "s" : ""} · {stock} pcs
          </Text>
        </View>
      </Page>
    </Document>
  );
}
