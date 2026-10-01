// Catálogo mínimo local para presentación.
// Se amplía posteriormente con catálogos oficiales (CUPS, CUM/IUM, etc.) o con API/BD propia.
window.RIPS_CATALOGS = {
  serviceLabels: {
    consultas: "Consultas",
    procedimientos: "Procedimientos",
    urgencias: "Urgencias",
    hospitalizacion: "Hospitalización",
    recienNacidos: "Recién nacidos",
    medicamentos: "Medicamentos",
    otrosServicios: "Otros servicios"
  },
  codeNameFallback: {
    consultas: "Código de consulta / CUPS",
    procedimientos: "Código de procedimiento / CUPS",
    urgencias: "Diagnóstico principal / CIE-10",
    hospitalizacion: "Diagnóstico principal / CIE-10",
    recienNacidos: "Diagnóstico principal / CIE-10",
    medicamentos: "Medicamento",
    otrosServicios: "Otro servicio"
  }
};