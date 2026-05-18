import PDFDocument from 'pdfkit';
import { Transform, PassThrough } from 'stream';
import type { PDFDocument as PDFDocumentType } from 'pdfkit';
import { TransactionHistoryRow, TransactionReceiptData } from './type';


export class PdfGenerator {
  static generateTransactionReceipt(
    data: TransactionReceiptData,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(20).text('TRANSACTION RECEIPT', { align: 'center' });
      doc.moveDown();
      doc.fontSize(10).fillColor('#666');
      doc.text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
      doc.moveDown(2);

      this.drawDivider(doc);

      doc.fontSize(12).fillColor('#000');
      const labelWidth = 150;
      const valueWidth = 350;
      let y = doc.y;

      doc.text('Transaction ID', labelWidth, y, {
        width: labelWidth,
        align: 'left',
      });
      doc.text(data.transactionId, labelWidth, y, {
        width: valueWidth,
        align: 'left',
      });
      y += 20;

      doc.text('Date', labelWidth, y, { width: labelWidth, align: 'left' });
      doc.text(data.date, labelWidth, y, { width: valueWidth, align: 'left' });
      y += 20;

      doc.text('Account Name', labelWidth, y, {
        width: labelWidth,
        align: 'left',
      });
      doc.text(data.accountName, labelWidth, y, {
        width: valueWidth,
        align: 'left',
      });
      y += 20;

      doc.text('Wallet Address', labelWidth, y, {
        width: labelWidth,
        align: 'left',
      });
      doc.text(data.walletAddress, labelWidth, y, {
        width: valueWidth,
        align: 'left',
      });
      y += 20;

      doc.text('Transaction Type', labelWidth, y, {
        width: labelWidth,
        align: 'left',
      });
      doc.text(data.transactionType, labelWidth, y, {
        width: valueWidth,
        align: 'left',
      });
      y += 20;

      doc.text('Status', labelWidth, y, { width: labelWidth, align: 'left' });
      const statusColor = data.status === 'COMPLETED' ? '#22c55e' : '#ef4444';
      doc
        .fillColor(statusColor)
        .text(data.status, labelWidth, y, { width: valueWidth, align: 'left' });
      doc.fillColor('#000');
      y += 20;

      doc.text('Amount', labelWidth, y, { width: labelWidth, align: 'left' });
      doc.text(data.amountToken, labelWidth, y, {
        width: valueWidth,
        align: 'left',
      });
      y += 20;

      doc.text('Currency', labelWidth, y, { width: labelWidth, align: 'left' });
      doc.text(data.currency, labelWidth, y, {
        width: valueWidth,
        align: 'left',
      });
      y += 20;

      if (data.network) {
        doc.text('Network', labelWidth, y, {
          width: labelWidth,
          align: 'left',
        });
        doc.text(data.network, labelWidth, y, {
          width: valueWidth,
          align: 'left',
        });
        y += 20;
      }

      if (data.executedCryptoAmount) {
        doc.text('Executed Crypto', labelWidth, y, {
          width: labelWidth,
          align: 'left',
        });
        doc.text(data.executedCryptoAmount, labelWidth, y, {
          width: valueWidth,
          align: 'left',
        });
        y += 20;
      }

      if (data.executedFiatAmount) {
        doc.text('Executed Fiat (NGN)', labelWidth, y, {
          width: labelWidth,
          align: 'left',
        });
        doc.text(data.executedFiatAmount, labelWidth, y, {
          width: valueWidth,
          align: 'left',
        });
        y += 20;
      }

      if (data.executionPrice) {
        doc.text('Execution Price', labelWidth, y, {
          width: labelWidth,
          align: 'left',
        });
        doc.text(data.executionPrice, labelWidth, y, {
          width: valueWidth,
          align: 'left',
        });
      }

      doc.end();
    });
  }

  static generateTransactionHistory(
    data: TransactionHistoryRow[],
    options: {
      title?: string;
      userName?: string;
      userId?: string;
      startDate?: string;
      endDate?: string;
    } = {},
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 50 });
      const chunks: Buffer[] = [];

      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const title = options.title || 'TRANSACTION HISTORY';
      doc.fontSize(20).text(title, { align: 'center' });
      doc.moveDown();

      if (options.userName) {
        doc.fontSize(12).text(`User: ${options.userName}`, { align: 'center' });
      }
      if (options.userId) {
        doc
          .fontSize(10)
          .fillColor('#666')
          .text(`User ID: ${options.userId}`, { align: 'center' });
      }
      if (options.startDate || options.endDate) {
        const dateRange = `Period: ${options.startDate || 'Start'} - ${options.endDate || 'Today'}`;
        doc.text(dateRange, { align: 'center' });
      }
      doc.fontSize(10).fillColor('#666');
      doc.text(`Generated: ${new Date().toISOString()}`, { align: 'center' });
      doc.fillColor('#000');
      doc.moveDown(2);

      this.drawDivider(doc);
      doc.moveDown();

      const tableTop = doc.y;
      const colWidths = [100, 120, 80, 60, 100, 60];
      const headers = [
        'Date',
        'Account Name',
        'Type',
        'Status',
        'Amount',
        'Currency',
      ];
      let x = 50;

      doc.fontSize(10).font('Helvetica-Bold');
      headers.forEach((header, i) => {
        doc.text(header, x, tableTop, { width: colWidths[i], align: 'left' });
        x += colWidths[i];
      });
      doc.moveDown();

      doc.font('Helvetica').fontSize(9);
      let rowY = tableTop + 20;

      data.forEach((row, index) => {
        if (rowY > 700) {
          doc.addPage();
          rowY = 50;
        }

        x = 50;
        const values = [
          row.date.substring(0, 10),
          row.accountName.substring(0, 15),
          row.transactionType,
          row.status,
          row.amount,
          row.currency,
        ];

        values.forEach((val, i) => {
          doc.text(val, x, rowY, { width: colWidths[i], align: 'left' });
          x += colWidths[i];
        });

        rowY += 18;
      });

      doc.moveDown(2);
      doc.fontSize(10).fillColor('#666');
      doc.text(`Total Transactions: ${data.length}`, { align: 'center' });

      doc.end();
    });
  }

  static async generateMultipleReceipts(
    data: TransactionReceiptData[],
  ): Promise<Buffer> {
    const receipts = await Promise.all(
      data.map((receipt) => this.generateTransactionReceipt(receipt)),
    );

    return Buffer.concat(receipts);
  }

  private static drawDivider(doc: any) {
    doc.strokeColor('#ccc').lineWidth(1);
    doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
    doc.moveDown();
  }
}
