import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VitalTypeDef } from './vital-type.schema';

export class FieldRangeResponse {
  @ApiProperty({ example: 60 }) minValid!: number;
  @ApiProperty({ example: 260 }) maxValid!: number;
}

/** One entry of GET /vital-types `data[]` (v1.1). */
export class VitalTypeResponse {
  @ApiProperty({ example: 'BP' }) type!: string;
  @ApiProperty({ example: 'Blood pressure' }) label!: string;
  @ApiProperty({ example: 'mmHg', nullable: true }) unit!: string | null;
  @ApiProperty({ enum: ['numeric', 'pair', 'scale', 'text'] }) valueKind!: string;

  @ApiPropertyOptional({ description: 'numeric/scale: value range. text: character counts.' })
  minValid?: number;

  @ApiPropertyOptional() maxValid?: number;

  @ApiPropertyOptional({
    description: 'BP only: one range per field, each checked on its own.',
    type: 'object',
    additionalProperties: { $ref: '#/components/schemas/FieldRangeResponse' },
  })
  fields?: Record<string, FieldRangeResponse>;

  @ApiProperty({ example: false }) isOptional!: boolean;
  @ApiProperty({ example: true }) onForm!: boolean;
  @ApiProperty({ example: 1 }) version!: number;

  @ApiPropertyOptional({
    description:
      'Additive to v1.1: true for the whole-number parameters in the Parameters table.',
  })
  integerOnly?: boolean;

  @ApiPropertyOptional({ description: 'Additive to v1.1: allowed increment, e.g. 0.5 for sleep.' })
  step?: number;
}

export function toVitalTypeResponse(def: VitalTypeDef): VitalTypeResponse {
  const fields = def.fields
    ? Object.fromEntries(
        [...def.fields.entries()].map(([name, range]) => [
          name,
          { minValid: range.minValid, maxValid: range.maxValid },
        ]),
      )
    : undefined;

  return {
    type: def.type,
    label: def.label,
    unit: def.unit,
    valueKind: def.valueKind,
    ...(def.minValid !== null ? { minValid: def.minValid } : {}),
    ...(def.maxValid !== null ? { maxValid: def.maxValid } : {}),
    ...(fields ? { fields } : {}),
    isOptional: def.isOptional,
    onForm: def.onForm,
    version: def.version,
    ...(def.integerOnly ? { integerOnly: true } : {}),
    ...(def.step !== null ? { step: def.step } : {}),
  };
}
