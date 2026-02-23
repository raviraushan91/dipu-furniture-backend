import ErrorHandler from "../middlewares/errorMiddleware.js";
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import database from "../database/db.js";
import { generatePaymentIntent } from "../utils/generatePaymentIntent.js";

const normalizePhone = (value = "") => {
  const cleaned = String(value).replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
};

export const placeNewOrder = catchAsyncErrors(async (req, res, next) => {
  const {
    full_name,
    state,
    city,
    country,
    address,
    pincode,
    phone,
    delivery_date,
    orderedItems,
  } = req.body;
  if (
    !full_name ||
    !state ||
    !city ||
    !country ||
    !address ||
    !pincode ||
    !phone ||
    !delivery_date
  ) {
    return next(
      new ErrorHandler("Please provide complete shipping details.", 400)
    );
  }

  const items = Array.isArray(orderedItems)
    ? orderedItems
    : JSON.parse(orderedItems);

  if (!items || items.length === 0) {
    return next(new ErrorHandler("No items in cart.", 400));
  }

  const productIds = items
    .map((item) => item?.product?.id)
    .filter(Boolean);
  if (!productIds.length) {
    return next(new ErrorHandler("Invalid cart payload.", 400));
  }

  const { rows: products } = await database.query(
    `SELECT id, price, stock, name FROM products WHERE id = ANY($1::uuid[])`,
    [productIds]
  );

  let total_price = 0;
  const values = [];
  const placeholders = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const product = products.find((p) => p.id === item?.product?.id);

    if (!product) {
      return next(
        new ErrorHandler(`Product not found for ID: ${item?.product?.id}`, 404)
      );
    }

    if (item.quantity > product.stock) {
      return next(
        new ErrorHandler(
          `Only ${product.stock} units available for ${product.name}`,
          400
        )
      );
    }

    const itemTotal = product.price * item.quantity;
    total_price += itemTotal;

    const firstImage = item.product?.images?.[0];
    const imageUrl =
      typeof firstImage === "string" ? firstImage : firstImage?.url || "";

    values.push(
      null,
      product.id,
      item.quantity,
      product.price,
      imageUrl,
      product.name
    );

    const offset = index * 6;

    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${
        offset + 5
      }, $${offset + 6})`
    );
  }

  const tax_price = 0.18;
  const shipping_price = total_price >= 50 ? 0 : 2;
  total_price = Math.round(
    total_price + total_price * tax_price + shipping_price
  );

  await database.query("BEGIN");
  let orderId = null;
  let paymentResponse = null;
  try {
    const orderResult = await database.query(
      `INSERT INTO orders (buyer_id, total_price, tax_price, shipping_price) VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, total_price, tax_price, shipping_price]
    );

    orderId = orderResult.rows[0].id;

    for (let i = 0; i < values.length; i += 6) {
      values[i] = orderId;
    }

    await database.query(
      `
      INSERT INTO order_items (order_id, product_id, quantity, price, image, title)
      VALUES ${placeholders.join(", ")} RETURNING *
      `,
      values
    );

    await database.query(
      `
      INSERT INTO shipping_info (order_id, full_name, state, city, country, address, pincode, phone, delivery_date)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *
      `,
      [
        orderId,
        full_name,
        state,
        city,
        country,
        address,
        pincode,
        phone,
        delivery_date,
      ]
    );

    paymentResponse = await generatePaymentIntent(orderId, total_price);
    if (!paymentResponse.success) {
      throw new Error("Payment failed. Try again.");
    }

    await database.query("COMMIT");
  } catch (error) {
    await database.query("ROLLBACK");
    return next(
      new ErrorHandler(error?.message || "Failed to place order.", 500)
    );
  }

  res.status(200).json({
    success: true,
    message: "Order placed successfully. Please proceed to payment.",
    paymentIntent: paymentResponse.clientSecret,
    total_price,
  });
});

export const createBestPriceRequest = catchAsyncErrors(async (req, res, next) => {
  const {
    product_id,
    quantity,
    full_name,
    state,
    city,
    country,
    address,
    pincode,
    phone,
    live_location_url,
    latitude,
    longitude,
  } = req.body;

  if (
    !product_id ||
    !full_name ||
    !state ||
    !city ||
    !country ||
    !address ||
    !pincode ||
    !phone
  ) {
    return next(new ErrorHandler("Please provide complete details.", 400));
  }

  const product = await database.query(
    "SELECT id FROM products WHERE id = $1 LIMIT 1",
    [product_id]
  );
  if (!product.rows.length) {
    return next(new ErrorHandler("Product not found.", 404));
  }

  const safeQuantity = Number(quantity) > 0 ? Number(quantity) : 1;
  const normalizedPhone = normalizePhone(phone);

  const request = await database.query(
    `INSERT INTO best_price_requests
     (user_id, product_id, quantity, full_name, phone, state, city, country, address, pincode, live_location_url, latitude, longitude, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'Pending')
     RETURNING *`,
    [
      req.user.id,
      product_id,
      safeQuantity,
      full_name,
      normalizedPhone,
      state,
      city,
      country,
      address,
      pincode,
      live_location_url || null,
      latitude || null,
      longitude || null,
    ]
  );

  res.status(201).json({
    success: true,
    message: "Best price request submitted. Admin will confirm shortly.",
    request: request.rows[0],
  });
});

export const fetchAdminBestPriceRequests = catchAsyncErrors(
  async (_req, res, _next) => {
    const result = await database.query(
      `SELECT r.*,
          p.name AS product_name,
          p.images->0->>'url' AS product_image,
          u.name AS user_name,
          u.phone AS user_phone
       FROM best_price_requests r
       JOIN products p ON p.id = r.product_id
       JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`
    );

    res.status(200).json({
      success: true,
      requests: result.rows,
    });
  }
);

export const confirmBestPriceRequest = catchAsyncErrors(async (req, res, next) => {
  const { requestId } = req.params;

  const reqResult = await database.query(
    `SELECT r.*, p.name AS product_name, p.images
     FROM best_price_requests r
     JOIN products p ON p.id = r.product_id
     WHERE r.id = $1
     LIMIT 1`,
    [requestId]
  );

  if (!reqResult.rows.length) {
    return next(new ErrorHandler("Request not found.", 404));
  }

  const request = reqResult.rows[0];
  if (request.status === "Confirmed" && request.confirmed_order_id) {
    return res.status(200).json({
      success: true,
      message: "Request already confirmed.",
      orderId: request.confirmed_order_id,
    });
  }

  const orderResult = await database.query(
    `INSERT INTO orders (buyer_id, total_price, tax_price, shipping_price, order_status, paid_at)
     VALUES ($1, 0, 0, 0, 'Processing', NOW()) RETURNING *`,
    [request.user_id]
  );
  const orderId = orderResult.rows[0].id;

  const firstImage = request.images?.[0];
  const imageUrl = typeof firstImage === "string" ? firstImage : firstImage?.url || "";

  await database.query(
    `INSERT INTO order_items (order_id, product_id, quantity, price, image, title)
     VALUES ($1, $2, $3, 0, $4, $5)`,
    [orderId, request.product_id, request.quantity, imageUrl, request.product_name]
  );

  await database.query(
    `UPDATE products
     SET stock = GREATEST(stock - $1, 0),
         sold_count = sold_count + $1
     WHERE id = $2`,
    [request.quantity, request.product_id]
  );

  await database.query(
    `INSERT INTO shipping_info (order_id, full_name, state, city, country, address, pincode, phone, delivery_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      orderId,
      request.full_name,
      request.state,
      request.city,
      request.country,
      request.address,
      request.pincode,
      request.phone,
      null,
    ]
  );

  await database.query(
    `UPDATE best_price_requests
     SET status = 'Confirmed', confirmed_order_id = $1
     WHERE id = $2`,
    [orderId, requestId]
  );

  res.status(200).json({
    success: true,
    message: "Request confirmed and added to user orders.",
    orderId,
  });
});

export const fetchSingleOrder = catchAsyncErrors(async (req, res, next) => {
  const { orderId } = req.params;
  const result = await database.query(
    `
    SELECT 
 o.*, 
 COALESCE(
 json_agg(
json_build_object(
'order_item_id', oi.id,
'order_id', oi.order_id,
'product_id', oi.product_id,
'quantity', oi.quantity,
'price', oi.price,
'image', oi.image,
'title', oi.title
 ) ORDER BY oi.created_at DESC
 ) FILTER (WHERE oi.id IS NOT NULL), '[]'
 ) AS order_items,
 json_build_object(
 'full_name', s.full_name,
 'state', s.state,
 'city', s.city,
 'country', s.country,
 'address', s.address,
 'pincode', s.pincode,
 'phone', s.phone,
 'delivery_date', s.delivery_date
 ) AS shipping_info
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN shipping_info s ON o.id = s.order_id
WHERE o.id = $1
GROUP BY o.id, s.id;
`,
    [orderId]
  );

  res.status(200).json({
    success: true,
    message: "Order fetched.",
    orders: result.rows[0],
  });
});

export const fetchMyOrders = catchAsyncErrors(async (req, res, next) => {
  const result = await database.query(
    `
        SELECT o.*, COALESCE(
 json_agg(
  json_build_object(
 'order_item_id', oi.id,
 'order_id', oi.order_id,
 'product_id', oi.product_id,
 'quantity', oi.quantity,
 'price', oi.price,
 'image', oi.image,
 'title', oi.title
  ) ORDER BY oi.created_at DESC
 ) FILTER (WHERE oi.id IS NOT NULL), '[]'
 ) AS order_items,
json_build_object(
 'full_name', s.full_name,
 'state', s.state,
 'city', s.city,
 'country', s.country,
 'address', s.address,
 'pincode', s.pincode,
 'phone', s.phone,
 'delivery_date', s.delivery_date
 ) AS shipping_info 
 FROM orders o
 LEFT JOIN order_items oi ON o.id = oi.order_id
 LEFT JOIN shipping_info s ON o.id = s.order_id
WHERE o.buyer_id = $1
GROUP BY o.id, s.id
ORDER BY o.created_at DESC
        `,
    [req.user.id]
  );

  res.status(200).json({
    success: true,
    message: "All your orders are fetched.",
    myOrders: result.rows,
  });
});

export const fetchAllOrders = catchAsyncErrors(async (req, res, next) => {
  const result = await database.query(`
            SELECT o.*,
 COALESCE(json_agg(
 json_build_object(
 'order_item_id', oi.id,
 'order_id', oi.order_id,
 'product_id', oi.product_id,
 'quantity', oi.quantity,
 'price', oi.price,
 'image', oi.image,
 'title', oi.title
) ORDER BY oi.created_at DESC
) FILTER (WHERE oi.id IS NOT NULL), '[]' ) AS order_items, json_build_object(
'full_name', s.full_name,
 'state', s.state,
 'city', s.city,
'country', s.country,
 'address', s.address,
 'pincode', s.pincode,
 'phone', s.phone,
 'delivery_date', s.delivery_date 
) AS shipping_info
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
LEFT JOIN shipping_info s ON o.id = s.order_id
GROUP BY o.id, s.id
ORDER BY o.created_at DESC
        `);

  res.status(200).json({
    success: true,
    message: "All orders fetched.",
    orders: result.rows,
  });
});

export const updateOrderStatus = catchAsyncErrors(async (req, res, next) => {
  const { status } = req.body;
  if (!status) {
    return next(new ErrorHandler("Provide a valid status for order.", 400));
  }
  const { orderId } = req.params;
  const results = await database.query(
    `
    SELECT * FROM orders WHERE id = $1
    `,
    [orderId]
  );

  if (results.rows.length === 0) {
    return next(new ErrorHandler("Invalid order ID.", 404));
  }

  const updatedOrder = await database.query(
    `
    UPDATE orders SET order_status = $1 WHERE id = $2 RETURNING *
    `,
    [status, orderId]
  );

  res.status(200).json({
    success: true,
    message: "Order status updated.",
    updatedOrder: updatedOrder.rows[0],
  });
});

export const deleteOrder = catchAsyncErrors(async (req, res, next) => {
  const { orderId } = req.params;
  const results = await database.query(
    `
        DELETE FROM orders WHERE id = $1 RETURNING *
        `,
    [orderId]
  );
  if (results.rows.length === 0) {
    return next(new ErrorHandler("Invalid order ID.", 404));
  }

  res.status(200).json({
    success: true,
    message: "Order deleted.",
    order: results.rows[0],
  });
});
