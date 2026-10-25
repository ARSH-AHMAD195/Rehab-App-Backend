import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { DEFAULT_PAGE_LIMIT, LIMITS, MAX_PAGE_LIMIT } from '../common/constants';
import { toBoolean, trim } from '../categories/category.dto';

const trimEach = ({ value }: { value: unknown }) =>
  Array.isArray(value) ? value.map((step) => (typeof step === 'string' ? step.trim() : step)) : value;

/** Fields shared by create and update. On update every one is optional. */
abstract class ExerciseFieldsDto {
  @ApiPropertyOptional({ example: 'Strengthens the thigh muscles.', nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString() @MaxLength(LIMITS.DESCRIPTION)
  description?: string | null;

  @ApiPropertyOptional({ example: ['Sit upright', 'Straighten one knee slowly', 'Hold for 3 seconds'] })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trimEach)
  @IsArray() @ArrayMaxSize(LIMITS.INSTRUCTION_STEPS)
  @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(LIMITS.INSTRUCTION_STEP, { each: true })
  instructions?: string[];

  @ApiPropertyOptional({
    example: 'https://youtu.be/dQw4w9WgXcQ',
    nullable: true,
    description: 'A YouTube link (watch, share, embed or shorts) or a bare video id. null removes the video.',
  })
  @IsOptional()
  @IsString() @MaxLength(300)
  videoUrl?: string | null;
}

export class CreateExerciseDto extends ExerciseFieldsDto {
  @ApiProperty({ example: 'Seated knee extension' })
  @Transform(trim)
  @IsString() @MinLength(1) @MaxLength(LIMITS.EXERCISE_NAME)
  name!: string;

  @ApiProperty({ description: 'An active category id' })
  @IsMongoId()
  categoryId!: string;
}

export class UpdateExerciseDto extends ExerciseFieldsDto {
  @ApiPropertyOptional({ example: 'Seated knee extension' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString() @MinLength(1) @MaxLength(LIMITS.EXERCISE_NAME)
  name?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsMongoId()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'false deactivates; true brings it back (its category must be active).' })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class ListExercisesQueryDto {
  @ApiPropertyOptional({ example: 'STRENGTH', description: 'Category code' })
  @IsOptional() @IsString() @MaxLength(30)
  category?: string;

  @ApiPropertyOptional({ description: 'true (default) or false for deactivated ones' })
  @IsOptional() @Transform(toBoolean) @IsBoolean()
  active?: boolean;

  @ApiPropertyOptional({ description: 'Part of the name, any case' })
  @IsOptional() @Transform(trim) @IsString() @MaxLength(LIMITS.SEARCH)
  q?: string;

  @ApiPropertyOptional({ default: DEFAULT_PAGE_LIMIT, maximum: MAX_PAGE_LIMIT })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  cursor?: string;
}

export class VideoResponse {
  @ApiProperty({ example: 'YOUTUBE' }) provider!: string;
  @ApiProperty({ example: 'dQw4w9WgXcQ' }) videoId!: string;
  @ApiProperty({ example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }) url!: string;
}

export class ExerciseResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'Seated knee extension' }) name!: string;
  @ApiProperty() categoryId!: string;
  @ApiProperty({ example: 'STRENGTH', description: 'The category code' }) category!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ type: [String] }) instructions!: string[];
  @ApiProperty({ type: VideoResponse, nullable: true }) video!: VideoResponse | null;
  @ApiProperty() active!: boolean;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;
}

export class ExerciseListResponse {
  @ApiProperty({ type: [ExerciseResponse] }) data!: ExerciseResponse[];
  @ApiProperty({ nullable: true, type: String }) nextCursor!: string | null;
}
