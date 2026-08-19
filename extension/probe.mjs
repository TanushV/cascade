const parameters = {
  type: "object",
  properties: {
    value: { type: "string" }
  },
  required: ["value"],
  additionalProperties: false
};

export default function probeExtension(pi) {
  pi.registerTool({
    name: "cascade_probe_echo",
    label: "Cascade provider probe",
    description: "Echo a probe value. Call exactly once with value CASCADE_PROBE_OK.",
    parameters,
    executionMode: "sequential",
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: String(params.value) }],
        details: { echoed: params.value }
      };
    }
  });
}
