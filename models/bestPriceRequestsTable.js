import database from "../database/db.js";

export async function createBestPriceRequestsTable() {
  try {
    const query = `CREATE TABLE IF NOT EXISTS best_price_requests (
      id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
      user_id UUID NOT NULL,
      product_id UUID NOT NULL,
      quantity INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
      full_name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      state VARCHAR(100) NOT NULL,
      city VARCHAR(100) NOT NULL,
      country VARCHAR(100) NOT NULL,
      address TEXT NOT NULL,
      pincode VARCHAR(10) NOT NULL,
      live_location_url TEXT,
      latitude DECIMAL(10,7),
      longitude DECIMAL(10,7),
      status VARCHAR(20) NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Confirmed', 'Rejected')),
      confirmed_order_id UUID,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (confirmed_order_id) REFERENCES orders(id) ON DELETE SET NULL
    );`;

    await database.query(query);
  } catch (error) {
    console.error("Failed To Create Best Price Requests Table.", error);
    process.exit(1);
  }
}
