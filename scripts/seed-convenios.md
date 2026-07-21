# Seed de convenios plantilla

`0003_seed_convenios.sql` crea dos convenios globales (`empresa_id NULL`,
visibles para todas las empresas por la policy `nom_convenios_select`):

- **Fuera de convenio (LCT)** — categorías genéricas: Administrativo, Técnico, Jefatura.
- **UOCRA (Ley 22.250)** — categorías del convenio de la construcción: Oficial especializado, Oficial, Medio oficial, Ayudante, Sereno.

## Por qué `basico = 0`

El seed define **estructura**, no valores de escala salarial. Publicar un
básico desactualizado en el código sería peor que no publicarlo: alguien
podría liquidar con un monto viejo sin darse cuenta. Los valores reales
vigentes se cargan en Fase 4 (motor de liquidación UOCRA) como filas nuevas
de `nom_categorias` con `vigencia_desde` real — nunca se pisa un valor
existente, se versiona.

## Fuente para cargar los valores reales

Al llegar a Fase 4, cargar el básico vigente de cada categoría UOCRA desde
la escala salarial publicada por UOCRA / Cámara Argentina de la
Construcción para el período correspondiente (verificar la fecha de
vigencia exacta antes de cargar — la escala se actualiza varias veces al
año). Para "Fuera de convenio", el básico lo define cada empresa según su
propia política salarial.
