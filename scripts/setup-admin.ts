import bcrypt from "bcrypt";
import { db } from "../server/db";
import { users } from "../shared/schema";
import { eq } from "drizzle-orm";

async function setupAdmin() {
  try {
    // Check if admin already exists
    const existingAdmin = await db.select().from(users).where(eq(users.username, "admin"));
    
    if (existingAdmin.length > 0) {
      console.log("✓ Admin user already exists");
      return;
    }

    // Create admin user
    const passwordHash = await bcrypt.hash("admin123", 12);
    
    await db.insert(users).values({
      username: "admin",
      passwordHash,
      role: "super_admin",
      businessAccountId: null,
      mustChangePassword: "false",
    });

    console.log("✓ Admin user created successfully");
    console.log("  Username: admin");
    console.log("  Password: admin123");
    console.log("\nYou can now log in to the application!");
    
  } catch (error) {
    console.error("✗ Error setting up admin:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

setupAdmin();
