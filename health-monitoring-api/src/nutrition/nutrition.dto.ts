import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../time/day.service';
import { OPTION_KINDS } from './diet-chart';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const CODE = /^[A-Z0-9_]{1,40}$/;
const CODE_ISSUE = 'must be 1-40 capital letters, digits or _';

/** PUT /me/meals/today/:slot */
export class SaveMealDto {
  @ApiProperty({ example: '2026-11-14', description: "The patient's today, as the app last loaded it" })
  @IsCalendarDate()
  date!: string;

  @ApiProperty({ type: [String], example: ['POHA_DALIYA_UPMA', 'MILK'], description: 'What was eaten; [] clears the slot' })
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  optionCodes!: string[];
}

export class MealsQueryDto {
  @ApiPropertyOptional({ example: '2026-11-01', description: 'Default: 6 days before `to`' })
  @IsOptional()
  @IsCalendarDate()
  from?: string;

  @ApiPropertyOptional({ example: '2026-11-07', description: 'Default: today' })
  @IsOptional()
  @IsCalendarDate()
  to?: string;
}

export class TextDto {
  @ApiProperty({ example: 'Lunch' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(300)
  en!: string;

  @ApiPropertyOptional({ nullable: true, description: 'Hindi, once supplied' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(300)
  hi?: string | null;
}

export class FoodOptionDto {
  @ApiProperty({ example: 'ROTI_RICE' })
  @Matches(CODE, { message: CODE_ISSUE })
  code!: string;

  @ApiProperty({ type: TextDto })
  @ValidateNested()
  @Type(() => TextDto)
  label!: TextDto;

  @ApiProperty({ example: '3 + 1 katori' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  quantity!: string;

  @ApiProperty({ enum: Object.values(OPTION_KINDS) })
  @IsIn(Object.values(OPTION_KINDS))
  kind!: 'OPTION' | 'ADDON';
}

export class MealSlotDto {
  @ApiProperty({ example: 'LUNCH' })
  @Matches(CODE, { message: CODE_ISSUE })
  code!: string;

  @ApiProperty({ type: TextDto })
  @ValidateNested()
  @Type(() => TextDto)
  label!: TextDto;

  @ApiProperty({ example: '12:30-13:30' })
  @Matches(/^\d{2}:\d{2}-\d{2}:\d{2}$/, { message: 'must be like 12:30-13:30' })
  window!: string;

  @ApiProperty({ example: 711 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  kcal!: number;

  @ApiProperty({ example: 24.7 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  proteinG!: number;

  @ApiProperty({ type: [FoodOptionDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => FoodOptionDto)
  options!: FoodOptionDto[];
}

export class TargetsDto {
  @ApiProperty({ example: 2206 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  kcal!: number;

  @ApiProperty({ example: 82.4 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  proteinG!: number;
}

/** PATCH /doctor/patients/:patientId/diet-plan: send only what changes, plus the version read. */
export class UpdateDietPlanDto {
  @ApiProperty({ description: '0 while the patient is still on the hospital chart' })
  @IsInt()
  @Min(0)
  version!: number;

  @ApiPropertyOptional({ example: 'HIGH_CALORIE_HIGH_PROTEIN' })
  @IsOptional()
  @Matches(CODE, { message: CODE_ISSUE })
  dietType?: string;

  @ApiPropertyOptional({ type: TextDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TextDto)
  dietLabel?: TextDto;

  @ApiPropertyOptional({ type: TargetsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => TargetsDto)
  targets?: TargetsDto;

  @ApiPropertyOptional({ type: [MealSlotDto], description: 'The whole list of slots, replacing the current one' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(12)
  @ValidateNested({ each: true })
  @Type(() => MealSlotDto)
  slots?: MealSlotDto[];
}
