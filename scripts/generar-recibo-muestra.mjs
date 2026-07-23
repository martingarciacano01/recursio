// scripts/generar-recibo-muestra.mjs
// Genera un PDF de muestra desde datos fixture idénticos al modelo, para
// comparar visualmente el layout. Uso: node scripts/generar-recibo-muestra.mjs
import { generarReciboPdf } from '../src/utils/reciboPdf.js'
import { writeFileSync } from 'node:fs'

const items = [
  { codigo: 'C_SIPA', nombre: 'SIPA – Ley 24.241', tipo: 'aporte_patronal', monto: 133545.68, unidadTexto: '10,77 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'C_INSSJP', nombre: 'Ley 19.032 – INSSJP', tipo: 'aporte_patronal', monto: 19715.66, unidadTexto: '1,59 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'inssjp' },
  { codigo: 'C_ASIG', nombre: 'Asignaciones Familiares', tipo: 'aporte_patronal', monto: 58278.99, unidadTexto: '4,70 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'C_FNE', nombre: 'Fondo Nacional de Empleo', tipo: 'aporte_patronal', monto: 11655.80, unidadTexto: '0,94 %', baseCalculo: 1239978.42, grupoRecibo: 'contribucion', detalleRecibo: 'seguridad_social' },
  { codigo: 'C_OS', nombre: 'Obra social', tipo: 'aporte_patronal', monto: 83008.93, unidadTexto: '6,00 %', baseCalculo: 1383482.10, grupoRecibo: 'contribucion', detalleRecibo: 'obra_social' },
  { codigo: 'C_ART', nombre: 'Riesgos de Trabajo – Variable', tipo: 'aporte_patronal', monto: 41504.46, unidadTexto: '3,00 %', baseCalculo: 1383482.10, grupoRecibo: 'contribucion', detalleRecibo: 'art' },
  { codigo: 'C_OSECAC', nombre: 'Contribución Solidaria OSECAC', tipo: 'aporte_patronal', monto: 28000, unidadTexto: '1', baseCalculo: 28000, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  { codigo: 'C_INACAP', nombre: 'INACAP', tipo: 'aporte_patronal', monto: 5481.25, unidadTexto: '1', baseCalculo: 5481.25, grupoRecibo: 'cct', detalleRecibo: 'sindical' },
  { codigo: 'C_SCVO', nombre: 'Seguro Colectivo de Vida Obligatorio', tipo: 'aporte_patronal', monto: 424.62, unidadTexto: '1', baseCalculo: 424.62, grupoRecibo: 'cct', detalleRecibo: 'scvo' },
  { codigo: 'BAS', nombre: 'Sueldo Básico', tipo: 'remunerativo', monto: 1096248, unidadTexto: '30', baseCalculo: 36541.60, grupoRecibo: 'remunerativo', detalleRecibo: null },
  { codigo: 'ANT', nombre: 'Adicional por antigüedad', tipo: 'remunerativo', monto: 54812.40, unidadTexto: '5,00 %', baseCalculo: 1096248, grupoRecibo: 'remunerativo', detalleRecibo: null },
  { codigo: 'INR', nombre: 'Incremento No Remunerativo', tipo: 'no_remunerativo', monto: 100000, unidadTexto: '30', baseCalculo: 3333.33, grupoRecibo: 'no_remunerativo', detalleRecibo: null },
  { codigo: 'JUB', nombre: 'Jubilación – Ley 24.241', tipo: 'descuento', monto: 137168.03, unidadTexto: '11,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'seguridad_social' },
  { codigo: 'INSSJP', nombre: 'Ley 19.032 - INSSJP', tipo: 'descuento', monto: 37409.46, unidadTexto: '3,00 %', baseCalculo: 1246982.10, grupoRecibo: 'descuento', detalleRecibo: 'inssjp' },
  { codigo: 'OS', nombre: 'Obra social', tipo: 'descuento', monto: 41504.46, unidadTexto: '3,00 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'obra_social' },
  { codigo: 'FAECYS', nombre: 'FAECyS - Art. 100 CCT 130/75', tipo: 'descuento', monto: 6917.41, unidadTexto: '0,50 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'sindical' },
  { codigo: 'SINDICATO', nombre: 'Sindicato - Art. 100 CCT 130/75', tipo: 'descuento', monto: 27669.64, unidadTexto: '2,00 %', baseCalculo: 1383482.10, grupoRecibo: 'descuento', detalleRecibo: 'sindical' },
]

const doc = generarReciboPdf({
  empresa: { nombre: 'LA EMPRESA S.A.', cuit: '30-99999999-9', domicilio: 'Aconquija 123456 (1080) – CABA' },
  persona: { nombre: 'Perez José', legajo: '99', cuil: '20-99999999-9', categoria: 'Maestranza y Servicios A', fechaIngreso: '01/01/2021', antiguedadReconocida: 0, banco: 'Macro' },
  periodo: { mes: '06', anio: '2026', descripcion: '04/2026 - 10/05/2026', fechaPago: '10/05/2026' },
  items,
  codigoRecibo: 'A-0001',
})
writeFileSync('recibo-muestra.pdf', Buffer.from(doc.output('arraybuffer')))
console.log('OK: recibo-muestra.pdf')
