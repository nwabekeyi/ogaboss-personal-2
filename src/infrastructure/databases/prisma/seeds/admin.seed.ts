// src/infrastructure/databases/prisma/seeds/super-admin.seed.ts
import { PrismaService } from '../prisma.service';
import { AdminRole, AccountStatus } from '../generated/prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaService();

export async function seedSuperAdmin() {
  const superAdminEmail = 'chidi90simeon@gmail.com';
  const superAdminPassword = 'SuperAdmin123';

  try {
    /* ================= 1. Get MASTER role ================= */
    const masterRole = await prisma.role.findUnique({ where: { title: 'MASTER' } });
    if (!masterRole) {
      throw new Error('MASTER role not found. Please seed MASTER role first.');
    }

    /* ================= 2. Hash password ================= */
    const hashedPassword = await bcrypt.hash(superAdminPassword, 12);

    /* ================= 3. Upsert Super Admin ================= */
    await prisma.admin.upsert({
      where: { email: superAdminEmail },
      update: {
        password: hashedPassword,
        fullName: 'Super Admin',
        firstName: 'Super',
        lastName: 'Admin',
        role: AdminRole.SUPER_ADMIN,
        internalRoleId: masterRole.id,
        accountStatus: AccountStatus.ACTIVE,
      },
      create: {
        email: superAdminEmail,
        password: hashedPassword,
        fullName: 'Super Admin',
        firstName: 'Super',
        lastName: 'Admin',
        role: AdminRole.SUPER_ADMIN,
        internalRoleId: masterRole.id,
        accountStatus: AccountStatus.ACTIVE,
        phoneNumber: null,
        residentialAddress: null,
        country: null,
      },
    });

    console.log('✅ Super Admin seeded successfully');
  } catch (error) {
    console.error('❌ Seeding Super Admin failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
