"use client";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

interface Variant {
  id: number;
  display_order?: string | number;
}
interface Item {
  name: string;
  price: string | number;
  variants: Variant[];
}
interface QRLabelPdfProps {
  item: Item;
  qrImages: Record<number, string>;
  id?: string;
}

const styles = StyleSheet.create({
  page: {
    padding: 4,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "#fff",
  },
  name: {
    fontSize: 12,
    fontWeight: 800,
    textAlign: "center",
  },
  variant: {
    fontSize: 11,
    padding: 2,
    fontWeight: 600,
  },
  price: {
    fontSize: 11,
    fontWeight: 800,
  },
  qr: {
    width: 60,
    height: 60,
  },
});

export const QRLabelPdf = ({ item, qrImages, id }: QRLabelPdfProps) => (
  <Document>
    {item.variants.map((variant, index) => {
      return (
        <Page key={variant.id} size={[70.87, 141.73]} style={styles.page}>
          <Text style={styles.name}>{item.name}</Text>
          {variant.display_order ? (
            <Text style={styles.variant}>Color #{variant.display_order}</Text>
          ) : null}
          <View>
            {/* eslint-disable-next-line*/}
            <Image src={qrImages[variant.id]} style={styles.qr} />
          </View>
          <Text style={styles.price}>Rs. {Number(item.price).toFixed(2)}</Text>
        </Page>
      );
    })}
  </Document>
);
