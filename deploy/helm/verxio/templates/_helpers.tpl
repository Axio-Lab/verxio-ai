{{/*
Spread a tier's pods across nodes and zones. Usage:
  {{- include "verxio.topologySpread" (dict "root" . "app" "verxio-api") | nindent 6 }}
*/}}
{{- define "verxio.topologySpread" -}}
{{- if .root.Values.topologySpread.enabled }}
topologySpreadConstraints:
  - maxSkew: {{ .root.Values.topologySpread.maxSkew }}
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: {{ .app }}
  - maxSkew: {{ .root.Values.topologySpread.maxSkew }}
    topologyKey: topology.kubernetes.io/zone
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        app: {{ .app }}
{{- end }}
{{- end -}}

{{/*
Probe trio for any container running the Hermes dashboard on :9119.

  startup   owns the cold boot (imports + skills sync) so liveness stays quiet
  readiness flips the Endpoint fast when the event loop stalls
  liveness  is the backstop behind the in-image dashboard-watchdog s6 service
*/}}
{{- define "verxio.hermesProbes" -}}
startupProbe:
  httpGet:
    path: /api/healthz
    port: 9119
  periodSeconds: 5
  timeoutSeconds: 5
  failureThreshold: {{ .Values.hermesProbes.startupFailureThreshold }}
readinessProbe:
  httpGet:
    path: /api/healthz
    port: 9119
  periodSeconds: 5
  timeoutSeconds: 5
  failureThreshold: {{ .Values.hermesProbes.readinessFailureThreshold }}
livenessProbe:
  httpGet:
    path: /api/healthz
    port: 9119
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: {{ .Values.hermesProbes.livenessFailureThreshold }}
{{- end -}}
