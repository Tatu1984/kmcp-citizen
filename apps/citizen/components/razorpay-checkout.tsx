import * as React from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { WebViewErrorEvent, WebViewHttpErrorEvent } from "react-native-webview/lib/WebViewTypes";

import { theme } from "../lib/theme";

/**
 * The one place a gateway checkout sheet is opened.
 *
 * Razorpay's web SDK has no React Native build, so this hosts the same
 * `checkout.js` a browser would load, inside a `WebView`, and reads its
 * result back over `postMessage`. Nothing about what is charged is decided
 * here: `gatewayOrder` and `gatewayKeyId` both come from a server response,
 * and this component's only job is to hand them to Razorpay unchanged and
 * report back what Razorpay says happened.
 */

export type CheckoutResult =
  | {
      status: "success";
      razorpayPaymentId: string;
      razorpayOrderId: string;
      razorpaySignature: string;
    }
  | { status: "cancelled" }
  | { status: "error"; message: string };

export interface GatewayOrder {
  id: string;
  amount: number;
  currency: string;
}

export function RazorpayCheckout({
  visible,
  gatewayKeyId,
  gatewayOrder,
  description,
  onResult,
  onRequestClose,
}: {
  visible: boolean;
  gatewayKeyId: string;
  gatewayOrder: GatewayOrder;
  description: string;
  onResult: (result: CheckoutResult) => void;
  onRequestClose: () => void;
}) {
  const insets = useSafeAreaInsets();

  const html = React.useMemo(
    () => buildCheckoutHtml({ gatewayKeyId, gatewayOrder, description }),
    [gatewayKeyId, gatewayOrder, description],
  );

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as CheckoutResult;
      onResult(data);
    } catch {
      onResult({
        status: "error",
        message: "The payment page sent something this app could not read.",
      });
    }
  };

  const handleError = (event: WebViewErrorEvent) => {
    onResult({
      status: "error",
      message: event.nativeEvent.description || "The payment page could not be loaded.",
    });
  };

  const handleHttpError = (event: WebViewHttpErrorEvent) => {
    onResult({
      status: "error",
      message: `The payment page returned an error (${event.nativeEvent.statusCode}).`,
    });
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onRequestClose}
    >
      <View style={styles.container}>
        <View style={[styles.header, { paddingTop: insets.top + theme.space(1) }]}>
          <Text style={styles.title} numberOfLines={1}>
            Complete payment
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onRequestClose}
            hitSlop={8}
            style={({ pressed }) => [styles.close, pressed && styles.closePressed]}
          >
            <Text style={styles.closeGlyph}>✕</Text>
          </Pressable>
        </View>

        <WebView
          source={{ html }}
          onMessage={handleMessage}
          onError={handleError}
          onHttpError={handleHttpError}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          originWhitelist={["*"]}
        />
      </View>
    </Modal>
  );
}

/**
 * The inline checkout page.
 *
 * Every value that came from the server is passed through `JSON.stringify`
 * individually rather than interpolated as text, so a stray quote or brace in
 * a description cannot break out of the object literal it sits in.
 */
function buildCheckoutHtml({
  gatewayKeyId,
  gatewayOrder,
  description,
}: {
  gatewayKeyId: string;
  gatewayOrder: GatewayOrder;
  description: string;
}): string {
  const key = JSON.stringify(gatewayKeyId);
  const orderId = JSON.stringify(gatewayOrder.id);
  const amount = JSON.stringify(gatewayOrder.amount);
  const currency = JSON.stringify(gatewayOrder.currency);
  const desc = JSON.stringify(description);
  const name = JSON.stringify("Smart Parking");

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
    <style>
      html, body { margin: 0; padding: 0; height: 100%; background: #FFFFFF; }
    </style>
  </head>
  <body>
    <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
    <script>
      function post(message) {
        if (window.ReactNativeWebView) {
          window.ReactNativeWebView.postMessage(JSON.stringify(message));
        }
      }

      try {
        var options = {
          key: ${key},
          order_id: ${orderId},
          amount: ${amount},
          currency: ${currency},
          name: ${name},
          description: ${desc},
          handler: function (response) {
            post({
              status: "success",
              razorpayPaymentId: response.razorpay_payment_id,
              razorpayOrderId: response.razorpay_order_id,
              razorpaySignature: response.razorpay_signature
            });
          },
          modal: {
            ondismiss: function () {
              post({ status: "cancelled" });
            }
          }
        };

        var rzp = new Razorpay(options);
        rzp.on("payment.failed", function (response) {
          post({
            status: "error",
            message: (response && response.error && response.error.description) || "The payment failed."
          });
        });
        rzp.open();
      } catch (err) {
        post({ status: "error", message: String(err && err.message ? err.message : err) });
      }
    </script>
  </body>
</html>`;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colour.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.space(2),
    paddingBottom: theme.space(1.25),
    borderBottomWidth: 1,
    borderBottomColor: theme.colour.line,
  },
  title: { ...theme.text.title, color: theme.colour.ink, flexShrink: 1 },
  close: {
    width: theme.minTouch,
    height: theme.minTouch,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
  },
  closePressed: { backgroundColor: theme.colour.raise },
  closeGlyph: { fontSize: 20, color: theme.colour.ink },
  webview: { flex: 1 },
});
