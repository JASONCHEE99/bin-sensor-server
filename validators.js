const { z } = require('zod');

const sensorPayloadSchema = z
  .object({
    sn: z.string().trim().min(3).max(64),
    sensor: z
      .object({
        battery: z.number().int().min(0).max(100).optional(),
        temperature_c: z.number().min(-40).max(85).optional(),
        distance_mm: z.number().int().nonnegative().optional(),
        distance_cm: z.number().nonnegative().optional(),
        position: z.string().trim().min(1).max(64).optional(),
        temperature_alarm: z.boolean().optional(),
        distance_alarm: z.boolean().optional(),
      })
      .refine(
        (sensor) =>
          sensor.distance_cm !== undefined ||
          sensor.distance_mm !== undefined ||
          sensor.temperature_c !== undefined ||
          sensor.battery !== undefined,
        {
          message:
            'At least one of battery, temperature_c, distance_mm, or distance_cm must be provided',
          path: ['distance_cm'],
        }
      ),
  })
  .transform((payload) => {
    const { sensor } = payload;
    if (
      sensor.distance_cm === undefined &&
      sensor.distance_mm !== undefined
    ) {
      sensor.distance_cm = sensor.distance_mm / 10;
    }
    if (
      sensor.distance_mm === undefined &&
      sensor.distance_cm !== undefined
    ) {
      sensor.distance_mm = Math.round(sensor.distance_cm * 10);
    }
    return payload;
  });

const addDeviceSchema = z.object({
  sn: z.string().trim().min(3).max(64),
});

const paginationSchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  sn: z.string().trim().min(1).optional(),
});

const statsQuerySchema = z.object({
  sn: z.string().trim().min(1).optional(),
});

function validate(schema, options = {}) {
  return (req, res, next) => {
    try {
      const source =
        options.source === 'query'
          ? req.query
          : options.source === 'params'
          ? req.params
          : req.body;
      const result = schema.parse(source);

      if (options.source === 'query') {
        req.query = result;
      } else if (options.source === 'params') {
        req.params = result;
      } else {
        req.body = result;
      }

      next();
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          error: true,
          message: 'Validation failed',
          details: err.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
          timestamp: new Date().toISOString(),
        });
      }
      next(err);
    }
  };
}

module.exports = {
  sensorPayloadSchema,
  addDeviceSchema,
  paginationSchema,
  statsQuerySchema,
  validate,
};
