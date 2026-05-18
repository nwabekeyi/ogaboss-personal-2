import { PrismaService } from '../prisma.service';

import * as bcrypt from 'bcrypt';

const prisma = new PrismaService();
const SALT_ROUNDS = 12;


export async function user() {
  /* =====================================================
     USER
  ===================================================== */
  const hashedPin = await bcrypt.hash('123456', SALT_ROUNDS);

  const localUser = await prisma.user.upsert({
    where: { email: 'chidi90simeon@gmail.com' },
    update: { pin: hashedPin },
    create: {
      email: 'chidi90simeon@gmail.com',
      pin: hashedPin,
      firstName: 'Chidiebere',
      lastName: 'Nwabekeyi',
      phoneNumber: '+2348123456789',
      dateOfBirth: new Date('1990-06-15'),
      gender: 'MALE',
      country: 'NG',
      residentialAddress: '12 Adeola Odeku Street, Victoria Island, Lagos, Nigeria',
      quidaxAccountId: '839214008',
      quidaxSnId: 'QDX-SUB-70377',
      status: 'ACTIVE',
      displayCurrency: 'NGN',
    },
  });



  console.log('USER SEEDED SUCCESSFULLY');
}
