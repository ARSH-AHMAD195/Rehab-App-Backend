import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { CATEGORY_CODE_PATTERN, LIMITS } from '../common/constants';

export const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Query strings arrive as text; "false" must not become true. */
export const toBoolean = ({ value }: { value: unknown }) =>
  value === 'true' ? true : value === 'false' ? false : value;

export class CreateCategoryDto {
  @ApiProperty({ example: 'BALANCE', description: 'Capitals, digits and _. Cannot change later.' })
  @IsString()
  @Matches(CATEGORY_CODE_PATTERN, { message: 'must be 2-30 capitals, digits or _, starting with a letter' })
  code!: string;

  @ApiProperty({ example: 'Balance' })
  @Transform(trim)
  @IsString() @MinLength(1) @MaxLength(LIMITS.CATEGORY_NAME)
  name!: string;

  @ApiPropertyOptional({ description: 'Display order. Defaults to after the last category.' })
  @IsOptional() @IsInt() @Min(0)
  order?: number;
}

/** PATCH: any of name, order, active. The code cannot change. */
export class UpdateCategoryDto {
  @ApiPropertyOptional({ example: 'Balance and posture' })
  @ValidateIf((_, value) => value !== undefined)
  @Transform(trim)
  @IsString() @MinLength(1) @MaxLength(LIMITS.CATEGORY_NAME)
  name?: string;

  @ApiPropertyOptional()
  @ValidateIf((_, value) => value !== undefined)
  @IsInt() @Min(0)
  order?: number;

  @ApiPropertyOptional({ description: 'false deactivates (refused while active exercises use it).' })
  @ValidateIf((_, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class ListCategoriesQueryDto {
  @ApiPropertyOptional({ description: 'Admin only: include deactivated categories.' })
  @IsOptional() @Transform(toBoolean) @IsBoolean()
  includeInactive?: boolean;
}

export class CategoryResponse {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'STRENGTH' }) code!: string;
  @ApiProperty({ example: 'Strength' }) name!: string;
  @ApiProperty({ example: 2 }) order!: number;
  @ApiProperty() active!: boolean;
}

export class CategoryListResponse {
  @ApiProperty({ type: [CategoryResponse] }) data!: CategoryResponse[];
}
