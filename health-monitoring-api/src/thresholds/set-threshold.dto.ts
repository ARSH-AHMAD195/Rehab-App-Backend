import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsMongoId, IsNumber, IsOptional } from 'class-validator';
import { BP_FIELDS, SEVERITIES, Severity } from '../common/constants';

/**
 * PUT /admin/alert-thresholds/:type (v1.1):
 * { "field": null, "low": null, "high": 6, "severity": "MEDIUM", "patientId": null }
 */
export class SetThresholdDto {
  @ApiPropertyOptional({
    enum: BP_FIELDS,
    nullable: true,
    description: 'Required for BP (systolic or diastolic); must be null otherwise.',
  })
  @IsOptional()
  @IsIn([...BP_FIELDS, null])
  field?: string | null;

  @ApiPropertyOptional({ nullable: true, example: null })
  @IsOptional()
  @IsNumber()
  low?: number | null;

  @ApiPropertyOptional({ nullable: true, example: 6 })
  @IsOptional()
  @IsNumber()
  high?: number | null;

  @ApiProperty({ enum: SEVERITIES })
  @IsEnum(SEVERITIES)
  severity!: Severity;

  @ApiPropertyOptional({
    nullable: true,
    description: 'Null for the global default, or a patient id to override it for that patient.',
  })
  @IsOptional()
  @IsMongoId()
  patientId?: string | null;
}
