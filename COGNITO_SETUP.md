# 🔐 Configuración de Cognito Hosted UI

## Paso 1: Obtener el Dominio del Hosted UI

Para usar el login de Cognito, necesitas configurar el dominio del Hosted UI:

1. Ve a la **Consola de AWS Cognito**: https://console.aws.amazon.com/cognito/
2. Selecciona tu **User Pool**
3. Ve a la pestaña **App integration** (Integración de aplicaciones)
4. Busca la sección **Domain** 
5. Si no tienes un dominio configurado:
   - Haz clic en **Actions** → **Create Cognito domain**
   - Ingresa un nombre único (ej: `tickr-app-123456`)
   - Guarda el dominio

## Paso 2: Configurar el Redirect URI

En la misma sección de **App integration**:

1. Ve a **App client list** y selecciona tu cliente
2. Busca **Hosted UI settings**
3. En **Allowed callback URLs**, agrega:
   ```
   http://localhost:3000
   ```
4. En **Allowed sign-out URLs**, agrega:
   ```
   http://localhost:3000
   ```
5. Asegúrate de que los **OAuth 2.0 grant types** incluyan:
   - ✅ Authorization code grant
6. Asegúrate de que los **OpenID Connect scopes** incluyan:
   - ✅ Email
   - ✅ OpenID
   - ✅ Profile

## Paso 3: Agregar el Dominio al .env

Agrega el dominio a tu archivo `.env`. El sistema acepta **3 formatos diferentes**:

### Opción 1: URL Completa (Recomendado)
```env
VITE_COGNITO_USER_POOL_ID=us-east-1_tu_pool_id
VITE_COGNITO_CLIENT_ID=tu_client_id
VITE_COGNITO_REGION=us-east-1
VITE_COGNITO_DOMAIN=https://tickr-app-123456.auth.us-east-1.amazoncognito.com
```

### Opción 2: Dominio con Sufijo
```env
VITE_COGNITO_DOMAIN=tickr-app-123456.auth.us-east-1.amazoncognito.com
```

### Opción 3: Solo el Prefijo
```env
VITE_COGNITO_DOMAIN=tickr-app-123456
```

**Todas las opciones funcionan correctamente.** Usa la que prefieras o la que copies directamente de AWS.

## Paso 4: Reiniciar el Servidor

```bash
npm run dev
```

## Verificación

Cuando hagas clic en **"Sign In"**, deberías ser redirigido a la página de login de Cognito que se ve así:

```
https://tickr-app-123456.auth.us-east-1.amazoncognito.com/login?...
```

## Troubleshooting

### Error: "Invalid redirect URI"
- Verifica que `http://localhost:3000` esté en **Allowed callback URLs**
- Asegúrate de que no haya espacios adicionales

### Error: "Invalid client"
- Verifica que `VITE_COGNITO_CLIENT_ID` sea correcto
- Verifica que el App Client tenga **Authorization code grant** habilitado

### Error: "Domain not configured"
- Asegúrate de haber agregado `VITE_COGNITO_DOMAIN` al archivo `.env`
- Reinicia el servidor después de modificar el `.env`

### No puedo crear usuarios
- Ve a **Sign-up experience** en tu User Pool
- Asegúrate de que **Self-registration** esté habilitado
- O crea usuarios manualmente desde la consola de AWS Cognito

## Alternativa: Usar cognito-config.json

Si prefieres, puedes agregar el dominio al archivo `cognito-config.json`:

```json
{
  "userPoolId": "us-east-1_tu_pool_id",
  "userPoolClientId": "tu_client_id",
  "region": "us-east-1",
  "hostedUIDomain": "tickr-app-123456"
}
```
