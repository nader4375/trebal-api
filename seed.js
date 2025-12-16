import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const pepper = process.env.PASSWORD_PEPPER || "";
  const adminEmail = "admin@trebal.local";
  const passwordHash = await bcrypt.hash("Admin12345!" + pepper, 12);

  await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      passwordHash,
      roles: ["ADMIN", "SELLER", "COLLABORATOR"],
      verified: true
    }
  });

  console.log("Admin seeded:", adminEmail);
}

main().finally(async () => prisma.$disconnect());
