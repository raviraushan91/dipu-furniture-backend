import database from "../database/db.js";

export async function createSpecialRequirementsTable() {
  try {
    const query = `CREATE TABLE IF NOT EXISTS special_requirements (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NULL,
      user_name VARCHAR(120) NOT NULL,
      product_needed TEXT NOT NULL,
      required_by_date DATE NOT NULL,
      quantity INT NOT NULL CHECK (quantity > 0),
      wood_type VARCHAR(120),
      dimensions VARCHAR(180) NOT NULL,
      mobile VARCHAR(20) NOT NULL,
      address TEXT NOT NULL,
      design_image JSONB DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    );`;

    await database.query(query);
  } catch (error) {
    console.error("Failed To Create Special Requirements Table.", error);
    process.exit(1);
  }
}
