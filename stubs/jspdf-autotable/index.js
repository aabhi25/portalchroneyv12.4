export default function autoTable(doc, options) {
  if (doc && typeof doc === 'object') {
    doc.lastAutoTable = { finalY: (options && options.startY ? options.startY + 20 : 20) };
  }
}
