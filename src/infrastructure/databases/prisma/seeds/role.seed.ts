// src/infrastructure/databases/prisma/seeds/master-role.seed.ts
import { PrismaService } from '../prisma.service';

const prisma = new PrismaService();

export async function seedMasterRole() {
  try {
    /* ================= 1. Define permissions ================= */
    const permissionData = [
      { key: 'DOWNLOAD_TRANSACTION_HISTORY', name: 'Download Transaction History' },
      { key: 'FLAG_USER', name: 'Flag User' },
      { key: 'EDIT_PERMISSION', name: 'Edit Permissions' },
      { key: 'ACCESS_TRANSACTION_HISTORY', name: 'View Transaction History' },
      { key: 'ADD_USER', name: 'Add Admin User' },
      { key: 'USER_ACCOUNT_ACCESS', name: 'Access User Accounts' },
      { key: 'EDIT_USER_ACCOUNT', name: 'Edit User Account' },
    ];

    /* ================= 2. Upsert permissions ================= */
    for (const perm of permissionData) {
      await prisma.permissions.upsert({
        where: { key: perm.key },
        update: { name: perm.name, description: null },
        create: { key: perm.key.trim(), name: perm.name.trim(), description: null },
      });
    }

    const permissions = await prisma.permissions.findMany({
      where: { key: { in: permissionData.map(p => p.key) } },
    });
    console.log(`✅ ${permissions.length} permissions ready`);

    /* ================= 3. Upsert MASTER role ================= */
    const masterRole = await prisma.role.upsert({
      where: { title: 'MASTER' },
      update: {
        isActive: true,
        permissions: { set: [], connect: permissions.map(p => ({ id: p.id })) },
      },
      create: {
        title: 'MASTER',
        description: 'Master role with full system access (assigned to Super Admin)',
        isActive: true,
        permissions: { connect: permissions.map(p => ({ id: p.id })) },
      },
    });

    console.log(`✅ MASTER role ready (ID: ${masterRole.id}) with ${permissions.length} permissions`);
  } catch (error) {
    console.error('❌ Seeding MASTER role failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}
