# dsh-plugin-role-auditor — Role Auditor

Auditor de permisos de Discord para DeepSeek Harness: detecta roles con permisos peligrosos, webhooks expuestos y configuraciones de riesgo, sin modificar nada.

## Herramientas

Ver `docs/COMO-FUNCIONA.md` para el detalle.

## Instalación

Desde **DSH → Settings → Plugins** instala `github:thegabopacheco-sudo/dsh-plugin-role-auditor` y permite el script de instalación.

```
dsh plugin --profile <perfil> add github:thegabopacheco-sudo/dsh-plugin-role-auditor
```

## Seguridad

- Lectura por defecto; escritura solo con `confirm:true` y pedido explícito.
- `DSH_ROLE_AUDITOR_MODE=read-only` desactiva acciones.
- Listas blancas y auditoría en `<DSH_HOME>\cache\role-auditor\audit.jsonl`.

## Licencia

MIT © thegabopacheco-sudo
