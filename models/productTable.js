import database from "../database/db.js";

export async function createProductsTable() {
  try {
    const query = `CREATE TABLE IF NOT EXISTS products (
         id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
         name VARCHAR(255) NOT NULL,
         description TEXT NOT NULL,
         price DECIMAL(7,2) NOT NULL CHECK (price >= 0),
         category VARCHAR(100) NOT NULL,
         query_phone VARCHAR(20),
         whatsapp_phone VARCHAR(20),
         best_price_text VARCHAR(120),
         ratings DECIMAL(3,2) DEFAULT 0 CHECK (ratings BETWEEN 0 AND 5),
         sold_count INT NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
         images JSONB DEFAULT '[]'::JSONB,
         stock INT NOT NULL CHECK (stock >= 0),
         created_by UUID NOT NULL,
         created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
         FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE);`;
    await database.query(query);
    await database.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS query_phone VARCHAR(20)`
    );
    await database.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS whatsapp_phone VARCHAR(20)`
    );
    await database.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS best_price_text VARCHAR(120)`
    );
    await database.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS material VARCHAR(160)`
    );
    await database.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS dimensions VARCHAR(160)`
    );
    await database.query(
      `ALTER TABLE products ADD COLUMN IF NOT EXISTS sold_count INT NOT NULL DEFAULT 0`
    );
  } catch (error) {
    console.error("Failed To Create Products Table.", error);
    process.exit(1);
  }
}
