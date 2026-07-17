# API Retenciones SIFEN — DUTRIEC SA

Sistema de gestión y envío de comprobantes de retención de IVA integrado con el sistema SIFEN/TESAKA del Paraguay.

---

## Requisitos previos

- **Java 21** — [Descargar desde Adoptium](https://adoptium.net)
- **Git** — [Descargar desde git-scm.com](https://git-scm.com/download/win)
- **MariaDB** — versión 10.x o superior
- **HeidiSQL** u otro cliente SQL (opcional, para administrar la BD)

---

## Instalación

### 1. Clonar el repositorio

```cmd
git clone https://github.com/Nicoib25/api-retenciones.git
cd api-retenciones
```

### 2. Crear la base de datos

Abrí HeidiSQL y conectate a tu MariaDB local. Luego ejecutá el script:

**Menú Archivo → Ejecutar archivo SQL → seleccionar `retenciones_sifen.sql`**

Esto crea la BD `retenciones_sifen` con todas las tablas y datos iniciales.

### 3. Configurar credenciales

Abrí el archivo:
```
src/main/java/com/dutriec/apiretenciones/DataSourceConfig.java
```

Buscá el método `mariadbDataSource()` y cambiá el usuario y contraseña de MariaDB:

```java
config.setUsername("root");         // ← tu usuario MariaDB
config.setPassword("TU_CLAVE");     // ← tu contraseña MariaDB
```

> **No modificar** el método `sqlAnywhereDataSource()` — apunta al servidor de DUTRIEC y no requiere cambios.

### 4. Levantar el servidor

```cmd
mvnw clean spring-boot:run
```

Esperá el mensaje:
```
Started ApiRetencionesApplication in X seconds
```

### 5. Acceder al sistema

Abrí el navegador en:
```
http://127.0.0.1:8080
```

**Usuarios disponibles:**

| Usuario | Contraseña | Rol |
|---|---|---|
| soporte | (consultar al equipo) | SOPORTE |
| admin | (consultar al equipo) | JEFE |
| asistente | (consultar al equipo) | ASISTENTE |

---

## Colaborar con cambios

El proyecto usa Git con el repo principal en `Nicoib25/api-retenciones`.

### Traer cambios del equipo

```cmd
cd api-retenciones
git fetch origin
git log HEAD..origin/master --oneline
git merge origin/master
mvnw clean spring-boot:run
```

### Subir tus cambios

```cmd
git add .
git commit -m "descripcion de los cambios"
git push origin master
```

---

## Estructura del proyecto

```
api-retenciones/
├── src/main/java/com/dutriec/apiretenciones/
│   ├── ApiRetencionesApplication.java   — Punto de entrada
│   ├── DataSourceConfig.java            — Configuración de BD (SQL Anywhere + MariaDB)
│   ├── Factura.java                     — Modelo de factura (SQL Anywhere)
│   ├── FacturaRepository.java           — Queries a SQL Anywhere
│   ├── FacturaController.java           — Endpoint POST /retenciones/enviar-lote
│   ├── DashboardController.java         — Endpoints del dashboard y migraciones
│   ├── RetencionRepository.java         — Queries a MariaDB
│   └── TesakaController.java            — Lógica de generación TXT TESAKA
├── src/main/resources/
│   ├── application.properties           — Configuración del servidor
│   └── static/                          — Frontend (HTML, CSS, JS)
└── retenciones_sifen.sql               — Script completo de la BD
```

---

## Notas importantes

- El sistema usa **dos bases de datos**: SQL Anywhere (solo lectura, servidor DUTRIEC) y MariaDB (local, escritura).
- Para cambios en archivos **Java**: reiniciar con `mvnw clean spring-boot:run`.
- Para cambios en **HTML/CSS**: reiniciar con `mvnw clean spring-boot:run`.
- Para cambios en **JS**: solo recargar el navegador con **Ctrl+Shift+R**.
- Acceder siempre por `http://127.0.0.1:8080` (no `localhost`).
