import { pkr } from './api'

/**
 * Download a trip plan as a PDF. jsPDF is loaded only when someone asks for
 * a PDF, so it never weighs on the first page load. Text is laid out line by
 * line with wrapping and page breaks; Latin script only (jsPDF's built-in
 * fonts have no Urdu glyphs), which is why the PDF is always in English.
 */
export async function downloadPlanPdf(plan) {
  const { jsPDF } = await import('jspdf')
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()
  const M = 48
  let y = M

  const ensure = (h) => { if (y + h > H - M) { doc.addPage(); y = M } }
  const text = (s, { size = 10.5, bold = false, color = [40, 44, 52], gap = 4 } = {}) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
    doc.setTextColor(...color)
    for (const line of doc.splitTextToSize(String(s ?? ''), W - M * 2)) {
      ensure(size + gap)
      doc.text(line, M, y)
      y += size + gap
    }
  }

  doc.setFillColor(15, 23, 39)
  doc.rect(0, 0, W, 88, 'F')
  doc.setTextColor(237, 232, 224)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20)
  doc.text(plan.title || 'Trip plan', M, 44)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  doc.setTextColor(185, 180, 172)
  doc.text('Northern Trails · Gilgit-Baltistan & Chitral', M, 64)
  y = 116

  if (plan.summary) { text(plan.summary, { size: 11 }); y += 6 }
  if (plan.destinations?.length) {
    text('Destinations: ' + plan.destinations.map((d) => `${d.name} (safety ${d.safety?.score ?? '–'}/100)`).join(' · '),
         { size: 10, color: [90, 96, 108] })
    y += 8
  }

  for (const d of plan.days || []) {
    ensure(60)
    text(`Day ${d.day}. ${d.title}`, { size: 12.5, bold: true, color: [30, 110, 107], gap: 5 })
    text(d.location, { size: 9.5, color: [110, 116, 128] })
    for (const a of d.activities || []) text('• ' + a, { size: 10.5 })
    if (d.restaurant) text(`Eat: ${d.restaurant.name} (${d.restaurant.cuisine}, ${d.restaurant.distance_km} km)`, { size: 10, color: [90, 96, 108] })
    if (d.package_id) text('Part of a booked package', { size: 9.5, color: [150, 110, 30] })
    if (d.est_cost_pkr) text(`Estimated ground cost: ${pkr(d.est_cost_pkr)}`, { size: 9.5, color: [90, 96, 108] })
    y += 8
  }

  if (plan.costs) {
    ensure(90)
    y += 4
    text('Estimated costs', { size: 13, bold: true })
    text(`Packages: ${pkr(plan.costs.packages_pkr)}`)
    text(`Other days (hotel, food, local transport): ${pkr(plan.costs.ground_pkr)}`)
    text(`Total: ${pkr(plan.costs.total_pkr)}${plan.costs.budget_pkr ? ` of a ${pkr(plan.costs.budget_pkr)} budget` : ''}`, { bold: true })
    if (plan.costs.basis) text(plan.costs.basis, { size: 9, color: [110, 116, 128] })
  }
  if (plan.tips?.length) {
    y += 8
    text('Before you go', { size: 13, bold: true })
    for (const tip of plan.tips) text('• ' + tip, { size: 10 })
  }
  y += 10
  text('Road, weather and safety conditions change quickly. Check the live conditions on the app before setting off. Emergency: Rescue 1122.',
       { size: 8.5, color: [130, 134, 142] })

  const name = (plan.title || 'trip-plan').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  doc.save(`${name || 'trip-plan'}.pdf`)
}
