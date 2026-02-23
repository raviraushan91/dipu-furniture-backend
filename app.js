import express from "express";
import { config } from "dotenv";
import cors from "cors";
import cookieParser from "cookie-parser";
import fileUpload from "express-fileupload";
import passport from "passport";

// ✅ Corrected Relative Paths
import { createTables } from "./utils/createTables.js";
import { errorMiddleware } from "./middlewares/errorMiddleware.js";
import authRouter from "./database/router/authRoutes.js";
import productRouter from "./database/router/productRoutes.js";
import adminRouter from "./database/router/adminRoutes.js";
import orderRouter from "./database/router/orderRoutes.js";
import contactRouter from "./database/router/contactRoutes.js";
import Stripe from "stripe";
import database from "./database/db.js";
import { initPassport } from "./config/passport.js";

const app = express();

config({ path: "./config/config.env" });
initPassport();
const allowedOrigins = [process.env.FRONTEND_URL, process.env.DASHBOARD_URL].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("CORS policy does not allow this origin."));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.post(
  "/api/v1/payment/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = Stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (error) {
      return res.status(400).send(`Webhook Error: ${error.message || error}`);
    }

    // Handling the Event

    if (event.type === "payment_intent.succeeded") {
      const paymentIntent_client_secret = event.data.object.client_secret;
      try {
        // Mark payment as paid only once to avoid duplicate stock/sold_count updates on webhook retries.
        const updatedPaymentStatus = "Paid";
        const paymentTableUpdateResult = await database.query(
          `UPDATE payments
           SET payment_status = $1
           WHERE payment_intent_id = $2 AND payment_status <> 'Paid'
           RETURNING *`,
          [updatedPaymentStatus, paymentIntent_client_secret]
        );

        if (!paymentTableUpdateResult.rows.length) {
          return res.status(200).send({ received: true });
        }

        await database.query("BEGIN");

        await database.query(
          `UPDATE orders SET paid_at = NOW() WHERE id = $1 RETURNING *`,
          [paymentTableUpdateResult.rows[0].order_id]
        );

        // Reduce stock and increase sold_count for each ordered product.
        const orderId = paymentTableUpdateResult.rows[0].order_id;

        const { rows: orderedItems } = await database.query(
          `
            SELECT product_id, quantity FROM order_items WHERE order_id = $1
          `,
          [orderId]
        );

        // For each ordered item, reduce the product stock
        for (const item of orderedItems) {
          await database.query(
            `UPDATE products
             SET stock = GREATEST(stock - $1, 0),
                 sold_count = sold_count + $1
             WHERE id = $2`,
            [item.quantity, item.product_id]
          );
        }

        await database.query("COMMIT");
      } catch (error) {
        try {
          await database.query("ROLLBACK");
        } catch (_rollbackError) {}
        return res
          .status(500)
          .send(`Error updating paid_at timestamp in orders table.`);
      }
    }
    res.status(200).send({ received: true });
  }
);

app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(passport.initialize());

app.use(
  fileUpload({
    tempFileDir: "./uploads",
    useTempFiles: true,
    limits: { fileSize: 5 * 1024 * 1024 },
    abortOnLimit: true,
    safeFileNames: true,
    preserveExtension: true,
  })
);

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/product", productRouter);
app.use("/api/v1/admin", adminRouter);
app.use("/api/v1/order", orderRouter);
app.use("/api/v1/contact", contactRouter);

createTables();

app.use(errorMiddleware);

export default app;
