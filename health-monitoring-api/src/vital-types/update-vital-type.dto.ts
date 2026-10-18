import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class FieldRangeDto {
  @ApiPropertyOptional() minValid!: number;
  @ApiPropertyOptional() maxValid!: number;
}

/**
 * PUT /admin/vital-types/:type (v1.1): "any of unit, label, minValid, maxValid
 * (or fields for BP), isOptional, onForm. type and valueKind cannot change."
 */
export class UpdateVitalTypeDto {
  @ApiPropertyOptional({ example: 'mmHg' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(20)
  unit?: string | null;

  @ApiPropertyOptional({ example: 'Blood pressure' })
  @IsOptional() @IsString() @MinLength(1) @MaxLength(60)
  label?: string;

  @ApiPropertyOptional({ example: 50 })
  @IsOptional() @IsNumber()
  minValid?: number;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsNumber()
  maxValid?: number;

  @ApiPropertyOptional({
    description: 'BP only: { systolic: { minValid, maxValid }, diastolic: { ... } }',
  })
  @IsOptional() @IsObject()
  fields?: Record<string, FieldRangeDto>;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  isOptional?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  onForm?: boolean;

  @ApiPropertyOptional({ description: 'Additive to v1.1. Whole numbers only.' })
  @IsOptional() @IsBoolean()
  integerOnly?: boolean;

  @ApiPropertyOptional({ description: 'Additive to v1.1. Allowed increment, e.g. 0.5.' })
  @IsOptional() @IsNumber() @Min(0)
  step?: number | null;

  @ApiPropertyOptional()
  @IsOptional() @IsInt() @Min(0)
  order?: number;
}
