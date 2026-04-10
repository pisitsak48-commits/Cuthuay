import PDFDocument from 'pdfkit';
import fs from 'fs';
import { BetRow, RiskReport } from '../models/types';

/**
 * Generate a professional PDF report for a lottery round.
 */
export async function generateRoundReport(
  round: any,
  risk: RiskReport,
  bets: BetRow[],
  cutPlan: any,
  outputPath: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const stream = fs.createWriteStream(outputPath);
    doc.pipe(stream);

    // ── Header ──────────────────────────────────────────────────────────
    doc
      .fontSize(22)
      .font('Helvetica-Bold')
      .text('CUT HUAY — ROUND REPORT', { align: 'center' });
    doc.moveDown(0.3);
    doc
      .fontSize(12)
      .font('Helvetica')
      .text(`Round: ${round?.name ?? '-'}  |  Draw Date: ${round?.draw_date ?? '-'}`, {
        align: 'center',
      });
    doc
      .fontSize(10)
      .text(`Generated: ${new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' })}`, {
        align: 'center',
      });

    doc.moveDown().moveTo(50, doc.y).lineTo(545, doc.y).stroke();
    doc.moveDown();

    // ── Risk Summary ────────────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').text('Risk Summary');
    doc.moveDown(0.5);
    const summaryRows = [
      ['Total Revenue', formatBaht(risk.total_revenue)],
      ['Max Loss (Worst Case)', formatBaht(risk.max_loss)],
      ['Risk %', `${risk.risk_percent.toFixed(2)}%`],
      ['Expected P&L', formatBaht(risk.expected_pl)],
      ['Total Bets', bets.length.toString()],
    ];
    drawTable(doc, 50, doc.y, ['Metric', 'Value'], summaryRows);
    doc.moveDown();

    // ── Top Risky Numbers ───────────────────────────────────────────────
    doc.fontSize(14).font('Helvetica-Bold').text('Top 10 Risky Numbers');
    doc.moveDown(0.5);
    const topRisk = risk.exposures.slice(0, 10).map((e) => [
      e.number,
      e.bet_type,
      formatBaht(e.total_bet),
      `${e.payout_rate}x`,
      formatBaht(e.gross_liability),
      e.net_pl >= 0 ? `+${formatBaht(e.net_pl)}` : formatBaht(e.net_pl),
    ]);
    drawTable(
      doc,
      50,
      doc.y,
      ['Number', 'Type', 'Total Bet', 'Rate', 'Liability', 'Net P&L'],
      topRisk,
    );
    doc.moveDown();

    // ── Cut Plan ────────────────────────────────────────────────────────
    if (cutPlan) {
      doc.fontSize(14).font('Helvetica-Bold').text('Applied Cut Plan');
      doc.moveDown(0.5);
      doc
        .fontSize(10)
        .font('Helvetica')
        .text(
          `Strategy: ${cutPlan.strategy ?? '-'}  |  Risk Limit: ${formatBaht(cutPlan.risk_limit)}  |  Total Hedge Cost: ${formatBaht(cutPlan.total_cost)}`,
        );
      doc.moveDown(0.5);

      const cuts = (typeof cutPlan.cuts === 'string'
        ? JSON.parse(cutPlan.cuts)
        : cutPlan.cuts) as any[];

      const cutRows = cuts.slice(0, 20).map((c) => [
        c.number,
        c.bet_type,
        formatBaht(c.cut_amount),
        `${c.dealer_rate}x`,
        formatBaht(c.before_risk),
        formatBaht(c.after_risk),
      ]);
      drawTable(
        doc,
        50,
        doc.y,
        ['Number', 'Type', 'Cut Amount', 'Dealer Rate', 'Before Risk', 'After Risk'],
        cutRows,
      );
    }

    doc.end();
    stream.on('finish', resolve);
    stream.on('error', reject);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBaht(value: number): string {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0,
  }).format(value);
}

function drawTable(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  headers: string[],
  rows: string[][],
): void {
  const colWidth = (545 - x) / headers.length;
  const rowHeight = 20;

  // Header row
  doc.fontSize(9).font('Helvetica-Bold');
  headers.forEach((h, i) => {
    doc
      .rect(x + i * colWidth, y, colWidth, rowHeight)
      .fillAndStroke('#1a1a2e', '#000');
    doc.fillColor('#ffffff').text(h, x + i * colWidth + 4, y + 6, {
      width: colWidth - 8,
      ellipsis: true,
    });
  });

  doc.fillColor('#000000').font('Helvetica').fontSize(8);

  rows.forEach((row, ri) => {
    const rowY = y + (ri + 1) * rowHeight;
    const bg = ri % 2 === 0 ? '#f8f9fa' : '#ffffff';
    row.forEach((cell, ci) => {
      doc.rect(x + ci * colWidth, rowY, colWidth, rowHeight).fillAndStroke(bg, '#cccccc');
      doc.fillColor('#000000').text(cell, x + ci * colWidth + 4, rowY + 6, {
        width: colWidth - 8,
        ellipsis: true,
      });
    });
  });

  doc.moveDown((rows.length + 2) * rowHeight / 14 + 1);
}
