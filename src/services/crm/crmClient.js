import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

/**
 * Cliente para interactuar con la API del CRM de Hipotecas.
 */
export class CrmClient {
  constructor() {
    this.baseUrl = env.crmApiUrl;
    this.token = env.crmBearerToken;
  }

  get headers() {
    return {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${this.token}`
    };
  }

  /**
   * 1. Crear un expediente nuevo
   * @param {Object} datos - Datos iniciales del cliente
   */
  async crearExpediente(datos) {
    if (!this.baseUrl) throw new Error("CRM no configurado");
    logger.info({ datos }, "Llamando al CRM: crearExpediente");
    const response = await fetch(`${this.baseUrl}/expedientes`, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(datos)
    });
    if (!response.ok) throw new Error(`Error al crear expediente: ${response.statusText}`);
    return await response.json();
  }

  /**
   * 2. Preguntar por el estado de un expediente
   * @param {string} idExpediente 
   */
  async consultarEstado(idExpediente) {
    if (!this.baseUrl) throw new Error("CRM no configurado");
    logger.info({ idExpediente }, "Llamando al CRM: consultarEstado");
    const response = await fetch(`${this.baseUrl}/expedientes/${idExpediente}`, {
      method: "GET",
      headers: this.headers
    });
    if (!response.ok) throw new Error(`Error al consultar estado: ${response.statusText}`);
    return await response.json();
  }

  /**
   * 3. Completar/actualizar datos del expediente
   * @param {string} idExpediente 
   * @param {Object} nuevosDatos 
   */
  async completarDatos(idExpediente, nuevosDatos) {
    if (!this.baseUrl) throw new Error("CRM no configurado");
    logger.info({ idExpediente, nuevosDatos }, "Llamando al CRM: completarDatos");
    const response = await fetch(`${this.baseUrl}/expedientes/${idExpediente}`, {
      method: "PATCH",
      headers: this.headers,
      body: JSON.stringify(nuevosDatos)
    });
    if (!response.ok) throw new Error(`Error al actualizar expediente: ${response.statusText}`);
    return await response.json();
  }
}
