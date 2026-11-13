import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsMongoId, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT, ROLES } from '../common/constants';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AuthUser } from '../users/auth-user';
import { CareAlertStatus } from './care-alert.schema';
import { CareAlertResponse, CareAlertsService } from './care-alerts.service';

export class CareAlertQueryDto {
  @ApiPropertyOptional({ enum: ['OPEN', 'ACKNOWLEDGED', 'ALL'], default: 'OPEN' })
  @IsOptional()
  @IsIn(['OPEN', 'ACKNOWLEDGED', 'ALL'])
  status?: CareAlertStatus | 'ALL';

  @ApiPropertyOptional({ description: 'Only this (linked) patient' })
  @IsOptional()
  @IsMongoId()
  patientId?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: MAX_PAGE_LIMIT, default: DEFAULT_PAGE_LIMIT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit?: number;

  @ApiPropertyOptional({ description: 'nextCursor from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;
}

export class AcknowledgeCareAlertDto {
  @ApiPropertyOptional({ example: 'Called the patient; repeat Hb booked', nullable: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(500)
  note?: string | null;
}

@ApiTags('Care-team alerts')
@ApiBearerAuth()
@Roles(ROLES.DOCTOR)
@Controller('doctor/care-alerts')
export class CareAlertsController {
  constructor(private readonly alerts: CareAlertsService) {}

  @Get()
  @ApiOperation({
    summary: "Alerts for the caller's patients",
    description:
      'New High value, weight loss over 5%, MUST rise, no logging for 3 days. Checked against the latest data on every call, ' +
      'so the list is always current. Every linked doctor sees the same alerts. openCount is for a badge.',
  })
  inbox(
    @CurrentUser() doctor: AuthUser,
    @Query() query: CareAlertQueryDto,
  ): Promise<{ data: CareAlertResponse[]; nextCursor: string | null; openCount: number }> {
    return this.alerts.inbox(doctor, query);
  }

  @Patch(':alertId')
  @ApiOperation({ summary: 'Acknowledge an alert', description: 'Once, by any linked doctor; 409 ALERT_ALREADY_ACKNOWLEDGED after that. Audited.' })
  acknowledge(
    @CurrentUser() doctor: AuthUser,
    @Param('alertId') alertId: string,
    @Body() body: AcknowledgeCareAlertDto,
  ): Promise<CareAlertResponse> {
    return this.alerts.acknowledge(doctor, alertId, body.note ?? null);
  }
}
