 import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/errorMiddleware.js";
import { v2 as cloudinary } from "cloudinary";
import database from "../database/db.js";
import { getAIRecommendation } from "../utils/getAIRecommendation.js";

const ALLOWED_CATEGORIES = [
  "Living Room",
  "Bedroom",
  "Dining",
  "Office",
  "Storage",
  "Outdoor",
  "Lighting",
  "Decor",
];
const isValidPrice = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
};

const isValidStock = (value) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0;
};

const normalizePhone = (value = "") => {
  const cleaned = String(value).replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
};

const isValidPhone = (value) => /^\+\d{10,15}$/.test(value);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;

const validateImageFile = (file) => {
  if (!file) return false;
  const mime = String(file.mimetype || "").toLowerCase();
  if (!mime.startsWith("image/")) return false;
  if (Number(file.size || 0) > MAX_IMAGE_SIZE_BYTES) return false;
  return true;
};

const clampRating = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(5, numeric));
};

export const createProduct = catchAsyncErrors(async (req, res, next) => {
  const { name, description, price, category, stock } = req.body;
  const material = String(req.body.material || "").trim();
  const dimensions = String(req.body.dimensions || "").trim();
  const queryPhone = normalizePhone(req.body.query_phone);
  const whatsappPhone = normalizePhone(req.body.whatsapp_phone);
  const bestPriceText = String(
    req.body.best_price_text || "Get Best Price"
  ).trim();
  const created_by = req.user.id;

  if (
    !name ||
    !description ||
    !category ||
    stock === undefined ||
    !material ||
    !dimensions
  ) {
    return next(
      new ErrorHandler("Please provide complete product details.", 400)
    );
  }

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return next(new ErrorHandler("Invalid product category.", 400));
  }

  if (!isValidStock(stock)) {
    return next(new ErrorHandler("Stock value is invalid.", 400));
  }

  if (!isValidPhone(queryPhone)) {
    return next(new ErrorHandler("Please provide a valid query mobile number.", 400));
  }

  if (whatsappPhone && !isValidPhone(whatsappPhone)) {
    return next(new ErrorHandler("Please provide a valid WhatsApp number.", 400));
  }

  let uploadedImages = [];
  if (req.files && req.files.images) {
    const images = Array.isArray(req.files.images)
      ? req.files.images
      : [req.files.images];

    const hasInvalidImage = images.some((file) => !validateImageFile(file));
    if (hasInvalidImage) {
      return next(
        new ErrorHandler("Only image files up to 5MB are allowed.", 400)
      );
    }

    for (const image of images) {
      const result = await cloudinary.uploader.upload(image.tempFilePath, {
        folder: "Ecommerce_Product_Images",
        width: 1000,
        crop: "scale",
      });

      uploadedImages.push({
        url: result.secure_url,
        public_id: result.public_id,
      });
    }
  }

  const normalizedPrice = isValidPrice(price) ? Number(price) : 0;
  const product = await database.query(
    `INSERT INTO products (name, description, price, category, stock, query_phone, whatsapp_phone, best_price_text, material, dimensions, images, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`,
    [
      name,
      description,
      normalizedPrice,
      category,
      Number(stock),
      queryPhone,
      whatsappPhone || queryPhone,
      bestPriceText || "Get Best Price",
      material,
      dimensions,
      JSON.stringify(uploadedImages),
      created_by,
    ]
  );

  res.status(201).json({
    success: true,
    message: "Product created successfully.",
    product: product.rows[0],
  });
});
// fetch all the products in the presents in the cart
export const fetchAllProducts = catchAsyncErrors(async (req, res, next) => {
  const { availability, price, category, ratings, search } = req.query;
  const page = parseInt(req.query.page) || 1;
  const requestedLimit = parseInt(req.query.limit);
  const limit =
    Number.isFinite(requestedLimit) && requestedLimit > 0
      ? Math.min(requestedLimit, 200)
      : 10;
  const offset = (page - 1) * limit;

  const conditions = [];
  let values = [];
  let index = 1;

  let paginationPlaceholders = {};

  // Filter products by availability
  if (availability === "in-stock") {
    conditions.push(`stock > 5`);
  } else if (availability === "limited") {
    conditions.push(`stock > 0 AND stock <= 5`);
  } else if (availability === "out-of-stock") {
    conditions.push(`stock = 0`);
  }

  // Filter products by price
  if (price) {
    const [minPrice, maxPrice] = price.split("-");
    if (minPrice && maxPrice) {
      conditions.push(`price BETWEEN $${index} AND $${index + 1}`);
      values.push(minPrice, maxPrice);
      index += 2;
    }
  }

  // Filter products by category
  if (category) {
    conditions.push(`category ILIKE $${index}`);
    values.push(`%${category}%`);
    index++;
  }

  // Filter products by rating
  if (ratings) {
    conditions.push(`ratings >= $${index}`);
    values.push(ratings);
    index++;
  }

  // Add search query
  if (search) {
    conditions.push(
      `(p.name ILIKE $${index} OR p.description ILIKE $${index})`
    );
    values.push(`%${search}%`);
    index++;
  }

  const whereClause = conditions.length
    ? `WHERE ${conditions.join(" AND ")}`
    : "";

  // Get count of filtered products
  const totalProductsResult = await database.query(
    `SELECT COUNT(*) FROM products p ${whereClause}`,
    values
  );

  const totalProducts = parseInt(totalProductsResult.rows[0].count);

  paginationPlaceholders.limit = `$${index}`;
  values.push(limit);
  index++;

  paginationPlaceholders.offset = `$${index}`;
  values.push(offset);
  index++;

  // FETCH WITH REVIEWS
  const query = `
    SELECT p.*, 
    COUNT(r.id) AS review_count 
    FROM products p 
    LEFT JOIN reviews r ON p.id = r.product_id
    ${whereClause}
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT ${paginationPlaceholders.limit}
    OFFSET ${paginationPlaceholders.offset}
    `;

  const result = await database.query(query, values);

  // QUERY FOR FETCHING NEW PRODUCTS
  const newProductsQuery = `
    SELECT p.*,
    COUNT(r.id) AS review_count
    FROM products p
    LEFT JOIN reviews r ON p.id = r.product_id
    WHERE p.created_at >= NOW() - INTERVAL '30 days'
    GROUP BY p.id
    ORDER BY p.created_at DESC
    LIMIT 8
  `;
  const newProductsResult = await database.query(newProductsQuery);

  // QUERY FOR FETCHING TOP RATING PRODUCTS (rating >= 4.5)
  const topRatedQuery = `
    SELECT p.*,
    COUNT(r.id) AS review_count
    FROM products p
    LEFT JOIN reviews r ON p.id = r.product_id
    WHERE p.ratings >= 4.5
    GROUP BY p.id
    ORDER BY p.ratings DESC, p.created_at DESC
    LIMIT 8
  `;
  const topRatedResult = await database.query(topRatedQuery);

  res.status(200).json({
    success: true,
    products: result.rows,
    totalProducts,
    newProducts: newProductsResult.rows,
    topRatedProducts: topRatedResult.rows,
  });
});

export const updateProduct = catchAsyncErrors(async (req, res, next) => {
  const { productId } = req.params;
  const { name, description, price, category, stock } = req.body;
  const material = String(req.body.material || "").trim();
  const dimensions = String(req.body.dimensions || "").trim();
  const queryPhone = normalizePhone(req.body.query_phone);
  const whatsappPhone = normalizePhone(req.body.whatsapp_phone);
  const bestPriceText = String(
    req.body.best_price_text || "Get Best Price"
  ).trim();

  if (
    !name ||
    !description ||
    !category ||
    stock === undefined ||
    !material ||
    !dimensions
  ) {
    return next(
      new ErrorHandler("Please provide complete product details.", 400)
    );
  }

  if (!ALLOWED_CATEGORIES.includes(category)) {
    return next(new ErrorHandler("Invalid product category.", 400));
  }

  if (!isValidStock(stock)) {
    return next(new ErrorHandler("Stock value is invalid.", 400));
  }

  if (!isValidPhone(queryPhone)) {
    return next(new ErrorHandler("Please provide a valid query mobile number.", 400));
  }

  if (whatsappPhone && !isValidPhone(whatsappPhone)) {
    return next(new ErrorHandler("Please provide a valid WhatsApp number.", 400));
  }

  const product = await database.query("SELECT * FROM products WHERE id = $1", [
    productId,
  ]);
  if (product.rows.length === 0) {
    return next(new ErrorHandler("Product not found.", 404));
  }

  let uploadedImages = product.rows[0].images || [];
  if (req.files && req.files.images) {
    const images = Array.isArray(req.files.images)
      ? req.files.images
      : [req.files.images];

    const hasInvalidImage = images.some((file) => !validateImageFile(file));
    if (hasInvalidImage) {
      return next(
        new ErrorHandler("Only image files up to 5MB are allowed.", 400)
      );
    }

    const oldImages = product.rows[0].images || [];
    for (const oldImage of oldImages) {
      if (oldImage?.public_id) {
        await cloudinary.uploader.destroy(oldImage.public_id);
      }
    }

    uploadedImages = [];
    for (const image of images) {
      const result = await cloudinary.uploader.upload(image.tempFilePath, {
        folder: "Ecommerce_Product_Images",
        width: 1000,
        crop: "scale",
      });
      uploadedImages.push({
        url: result.secure_url,
        public_id: result.public_id,
      });
    }
  }

  const currentProduct = product.rows[0];
  const finalPrice = isValidPrice(price) ? Number(price) : Number(currentProduct.price || 0);
  const result = await database.query(
    `UPDATE products
     SET name = $1, description = $2, price = $3, category = $4, stock = $5, images = $6
     , query_phone = $7, whatsapp_phone = $8, best_price_text = $9, material = $10, dimensions = $11
     WHERE id = $12 RETURNING *`,
    [
      name,
      description,
      finalPrice,
      category,
      Number(stock),
      JSON.stringify(uploadedImages),
      queryPhone,
      whatsappPhone || queryPhone,
      bestPriceText || currentProduct.best_price_text || "Get Best Price",
      material,
      dimensions,
      productId,
    ]
  );
  res.status(200).json({
    success: true,
    message: "Product updated successfully.",
    updatedProduct: result.rows[0],
  });
});

export const deleteProduct = catchAsyncErrors(async (req, res, next) => {
  const { productId } = req.params;

  const product = await database.query("SELECT * FROM products WHERE id = $1", [
    productId,
  ]);
  if (product.rows.length === 0) {
    return next(new ErrorHandler("Product not found.", 404));
  }

  const images = product.rows[0].images;

  const deleteResult = await database.query(
    "DELETE FROM products WHERE id = $1 RETURNING *",
    [productId]
  );

  if (deleteResult.rows.length === 0) {
    return next(new ErrorHandler("Failed to delete product.", 500));
  }

  // Delete images from Cloudinary
  if (images && images.length > 0) {
    for (const image of images) {
      await cloudinary.uploader.destroy(image.public_id);
    }
  }

  res.status(200).json({
    success: true,
    message: "Product deleted successfully.",
  });
});

export const fetchSingleProduct = catchAsyncErrors(async (req, res, next) => {
  const { productId } = req.params;

  const result = await database.query(
    `
        SELECT p.*,
        COALESCE(
        json_agg(
        json_build_object(
            'review_id', r.id,
            'rating', r.rating,
            'comment', r.comment,
            'reviewer', json_build_object(
            'id', u.id,
            'name', u.name,
            'avatar', u.avatar
            )) 
        ) FILTER (WHERE r.id IS NOT NULL), '[]') AS reviews
         FROM products p
         LEFT JOIN reviews r ON p.id = r.product_id
         LEFT JOIN users u ON r.user_id = u.id
         WHERE p.id  = $1
         GROUP BY p.id`,
    [productId]
  );

  res.status(200).json({
    success: true,
    message: "Product fetched successfully.",
    product: result.rows[0],
  });
});

export const postProductReview = catchAsyncErrors(async (req, res, next) => {
  const { productId } = req.params;
  const { rating, comment } = req.body;
  const cleanRating = clampRating(rating);
  const cleanComment = String(comment || "").trim();
  if (!cleanComment || cleanRating <= 0) {
    return next(new ErrorHandler("Please provide rating and comment.", 400));
  }

  const purchasheCheckQuery = `
    SELECT oi.product_id
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    WHERE o.buyer_id = $1
    AND oi.product_id = $2
    AND LOWER(o.order_status) = 'delivered'
    LIMIT 1 
  `;

  const { rows } = await database.query(purchasheCheckQuery, [
    req.user.id,
    productId,
  ]);

  if (rows.length === 0) {
    return res.status(403).json({
      success: false,
      message: "You can review only after product is delivered.",
    });
  }

  const product = await database.query("SELECT * FROM products WHERE id = $1", [
    productId,
  ]);
  if (product.rows.length === 0) {
    return next(new ErrorHandler("Product not found.", 404));
  }

  const isAlreadyReviewed = await database.query(
    `
    SELECT * FROM reviews WHERE product_id = $1 AND user_id = $2
    `,
    [productId, req.user.id]
  );

  let review;

  if (isAlreadyReviewed.rows.length > 0) {
    review = await database.query(
      "UPDATE reviews SET rating = $1, comment = $2 WHERE product_id = $3 AND user_id = $4 RETURNING *",
      [cleanRating, cleanComment, productId, req.user.id]
    );
  } else {
    review = await database.query(
      "INSERT INTO reviews (product_id, user_id, rating, comment) VALUES ($1, $2, $3, $4) RETURNING *",
      [productId, req.user.id, cleanRating, cleanComment]
    );
  }

  const allReviews = await database.query(
    `SELECT AVG(rating) AS avg_rating FROM reviews WHERE product_id = $1`,
    [productId]
  );

  const newAvgRating = Number(allReviews.rows[0].avg_rating || 0);

  const updatedProduct = await database.query(
    `
        UPDATE products SET ratings = $1 WHERE id = $2 RETURNING *
        `,
    [newAvgRating, productId]
  );

  res.status(200).json({
    success: true,
    message: "Review posted.",
    review: review.rows[0],
    product: updatedProduct.rows[0],
  });
});

export const deleteReview = catchAsyncErrors(async (req, res, next) => {
  const { productId } = req.params;
  const review = await database.query(
    "DELETE FROM reviews WHERE product_id = $1 AND user_id = $2 RETURNING *",
    [productId, req.user.id]
  );

  if (review.rows.length === 0) {
    return next(new ErrorHandler("Review not found.", 404));
  }

  const allReviews = await database.query(
    `SELECT AVG(rating) AS avg_rating FROM reviews WHERE product_id = $1`,
    [productId]
  );

  const newAvgRating = Number(allReviews.rows[0].avg_rating || 0);

  const updatedProduct = await database.query(
    `
        UPDATE products SET ratings = $1 WHERE id = $2 RETURNING *
        `,
    [newAvgRating, productId]
  );

  res.status(200).json({
    success: true,
    message: "Your review has been deleted.",
    review: review.rows[0],
    product: updatedProduct.rows[0],
  });
});

export const fetchAIFilteredProducts = catchAsyncErrors(
  async (req, res, next) => {
    const { userPrompt } = req.body;
    if (!userPrompt) {
      return next(new ErrorHandler("Provide a valid prompt.", 400));
    }

    const filterKeywords = (query) => {
      const stopWords = new Set([
        "the",
        "they",
        "them",
        "then",
        "I",
        "we",
        "you",
        "he",
        "she",
        "it",
        "is",
        "a",
        "an",
        "of",
        "and",
        "or",
        "to",
        "for",
        "from",
        "on",
        "who",
        "whom",
        "why",
        "when",
        "which",
        "with",
        "this",
        "that",
        "in",
        "at",
        "by",
        "be",
        "not",
        "was",
        "were",
        "has",
        "have",
        "had",
        "do",
        "does",
        "did",
        "so",
        "some",
        "any",
        "how",
        "can",
        "could",
        "should",
        "would",
        "there",
        "here",
        "just",
        "than",
        "because",
        "but",
        "its",
        "it's",
        "if",
        ".",
        ",",
        "!",
        "?",
        ">",
        "<",
        ";",
        "`",
        "1",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9",
        "10",
      ]);

      return query
        .toLowerCase()
        .replace(/[^\w\s]/g, "")
        .split(/\s+/)
        .filter((word) => !stopWords.has(word))
        .map((word) => `%${word}%`);
    };

    const keywords = filterKeywords(userPrompt);
    // STEP 1: Basic SQL Filtering
    const result = await database.query(
      `
        SELECT * FROM products
        WHERE name ILIKE ANY($1)
        OR description ILIKE ANY($1)
        OR category ILIKE ANY($1)
        LIMIT 200;     
        `,
      [keywords]
    );

    const filteredProducts = result.rows;

    if (filteredProducts.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No products found matching your prompt.",
        products: [],
      });
      
    }

    // STEP 2: AI FILTERING
    const { success, products } = await getAIRecommendation(
      req,
      res,
      userPrompt,
      filteredProducts
    );

    res.status(200).json({
      success: success,
      message: "AI filtered products.",
      products,
    });
  }
);
