import { v2 as cloudinary } from "cloudinary";
import database from "../database/db.js";
import { catchAsyncErrors } from "../middlewares/catchAsyncError.js";
import ErrorHandler from "../middlewares/errorMiddleware.js";

const normalizePhone = (value = "") => {
  const cleaned = String(value).replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
};

const isValidPhone = (value) => /^\+\d{10,15}$/.test(value);
const MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024;
const isValidImageFile = (file) => {
  if (!file) return false;
  const mime = String(file.mimetype || "").toLowerCase();
  return mime.startsWith("image/") && Number(file.size || 0) <= MAX_IMAGE_SIZE_BYTES;
};

export const createSpecialRequirement = catchAsyncErrors(
  async (req, res, next) => {
    const {
      user_name,
      product_needed,
      required_by_date,
      quantity,
      wood_type,
      dimensions,
      mobile,
      address,
    } = req.body;

    if (
      !user_name ||
      !product_needed ||
      !required_by_date ||
      !quantity ||
      !dimensions ||
      !mobile ||
      !address
    ) {
      return next(new ErrorHandler("Please provide all required details.", 400));
    }

    const safeQuantity = Number(quantity);
    if (!Number.isInteger(safeQuantity) || safeQuantity <= 0) {
      return next(new ErrorHandler("Quantity must be a valid positive number.", 400));
    }

    const normalizedPhone = normalizePhone(mobile);
    if (!isValidPhone(normalizedPhone)) {
      return next(new ErrorHandler("Please provide a valid mobile number.", 400));
    }

    let designImage = null;
    if (req.files?.design_image) {
      if (!isValidImageFile(req.files.design_image)) {
        return next(new ErrorHandler("Only image files up to 5MB are allowed.", 400));
      }
      const uploaded = await cloudinary.uploader.upload(
        req.files.design_image.tempFilePath,
        {
          folder: "Special_Requirements",
          width: 1200,
          crop: "scale",
        }
      );
      designImage = {
        url: uploaded.secure_url,
        public_id: uploaded.public_id,
      };
    }

    const result = await database.query(
      `INSERT INTO special_requirements
      (user_id, user_name, product_needed, required_by_date, quantity, wood_type, dimensions, mobile, address, design_image)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *`,
      [
        req.user?.id || null,
        user_name.trim(),
        product_needed.trim(),
        required_by_date,
        safeQuantity,
        wood_type ? String(wood_type).trim() : null,
        String(dimensions).trim(),
        normalizedPhone,
        String(address).trim(),
        designImage,
      ]
    );

    res.status(201).json({
      success: true,
      message: "Requirement submitted successfully.",
      requirement: result.rows[0],
    });
  }
);

export const fetchAdminSpecialRequirements = catchAsyncErrors(
  async (_req, res, _next) => {
    const result = await database.query(
      `SELECT r.*,
          u.name AS account_name,
          u.phone AS account_phone,
          u.email AS account_email
       FROM special_requirements r
       LEFT JOIN users u ON u.id = r.user_id
       ORDER BY r.created_at DESC`
    );

    res.status(200).json({
      success: true,
      requirements: result.rows,
    });
  }
);
