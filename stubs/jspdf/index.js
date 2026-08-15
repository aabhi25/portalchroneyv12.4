class jsPDF {
  constructor() {
    this.internal = {
      pageSize: {
        width: 210,
        height: 297,
        getWidth: () => 210,
        getHeight: () => 297
      },
      getNumberOfPages: () => 1
    };
    this.lastAutoTable = { finalY: 0 };
  }
  text() { return this; }
  setFontSize() { return this; }
  setFont() { return this; }
  addPage() { return this; }
  save() {}
  output() { return ''; }
  setProperties() { return this; }
  setTextColor() { return this; }
  setDrawColor() { return this; }
  setFillColor() { return this; }
  rect() { return this; }
  line() { return this; }
  addImage() { return this; }
}

export default jsPDF;
