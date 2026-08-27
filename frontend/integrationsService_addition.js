// ADD these two methods to the IntegrationsService class in
// frontend/services/integrationsService.js. They follow the same shape as the
// existing getShopifyStatus / connectShopify methods.

  async getPendingInstall() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/pending/`, {
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to check for app installs");
    return data;
  }

  async connectFromPendingInstall() {
    const response = await fetch(`${apiConfig.baseUrl}${SHOPIFY_BASE}/pending/`, {
      method: "POST",
      headers: authService.getAuthHeaders(),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.detail || "Failed to connect Shopify");
    return data;
  }
