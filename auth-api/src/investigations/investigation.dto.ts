import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsNotEmpty, IsNumber, IsObject, IsOptional, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import { TEST_CODES } from './investigation-tests';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const ifSent = ValidateIf((_o: unknown, value: unknown) => value !== undefined);

/**
 * POST /patients/:patientId/investigations. `values` is checked against the
 * test's own fields (GET /investigation-tests lists them) in the service.
 */
export class AddInvestigationDto {
  @ApiProperty({ enum: TEST_CODES, example: 'HB' })
  @IsIn(TEST_CODES)
  test!: string;

  @ApiProperty({ example: '2026-11-08', description: 'When the test was done (YYYY-MM-DD). Not in the future.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'must be a date as YYYY-MM-DD' })
  takenOn!: string;

  @ApiPropertyOptional({
    example: { value: 9.4 },
    description: 'Field key -> value, per the test definition. Leave out when wnl is true.',
  })
  @ifSent
  @IsObject()
  values?: Record<string, unknown>;

  @ApiPropertyOptional({ description: '"Within normal limits", for LFT, TFT, ECG and imaging', default: false })
  @ifSent
  @IsBoolean()
  wnl?: boolean;

  @ApiPropertyOptional({ example: 'Repeat after iron infusion', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  comment?: string | null;
}

export class RetractInvestigationDto {
  @ApiProperty({ example: 'Entered for the wrong patient' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}

export class InvestigationGridQueryDto {
  @ApiPropertyOptional({ enum: TEST_CODES, description: 'Only this test' })
  @IsOptional()
  @IsIn(TEST_CODES)
  test?: string;

  @ApiPropertyOptional({ enum: ['true', 'false'], default: 'false', description: 'Also show retracted results' })
  @IsOptional()
  @IsIn(['true', 'false'])
  includeRetracted?: 'true' | 'false';
}

/** PUT /admin/investigation-ranges: send null for both to remove the range. */
export class SetInvestigationRangeDto {
  @ApiProperty({ enum: TEST_CODES, example: 'HB' })
  @IsIn(TEST_CODES)
  test!: string;

  @ApiProperty({ example: 'value', description: 'A number field of that test' })
  @IsString()
  @IsNotEmpty()
  field!: string;

  @ApiProperty({ type: Number, nullable: true, example: 12 })
  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  low!: number | null;

  @ApiProperty({ type: Number, nullable: true, example: 16 })
  @ValidateIf((_o: unknown, value: unknown) => value !== null)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  high!: number | null;
}
