export const Schema = Object.freeze({
  string(options = {}) {
    return { type: "string", ...options };
  },
  number(options = {}) {
    return { type: "number", ...options };
  },
  boolean(options = {}) {
    return { type: "boolean", ...options };
  },
  array(items, options = {}) {
    return { type: "array", items, ...options };
  },
  object(properties, required = [], options = {}) {
    return { type: "object", properties, required, additionalProperties: false, ...options };
  },
  enum(values, options = {}) {
    return { type: "string", enum: values, ...options };
  }
});
