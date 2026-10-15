import { Body, Controller, Get, Param, Put, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ROLES } from '../common/constants';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AuthUser } from '../users/users.service';
import { ThresholdsQueryDto } from '../daily-logs/dto';
import { ThresholdResponse, ThresholdsService } from '../thresholds/thresholds.service';
import { SetThresholdDto } from '../thresholds/set-threshold.dto';
import { VitalTypesService } from '../vital-types/vital-types.service';
import { UpdateVitalTypeDto } from '../vital-types/update-vital-type.dto';
import { VitalTypeResponse } from '../vital-types/vital-type.response';

class ThresholdListResponse {
  data!: ThresholdResponse[];
  nextCursor!: string | null;
}

/**
 * The three admin routes of v1.1.
 *
 * Alert limits ship empty: "The system ships with no global limits until they
 * are signed off. Until then, alerts come only from limits an admin enters."
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles(ROLES.ADMIN)
@ApiForbiddenResponse({ description: 'FORBIDDEN_ROLE - caller is not an admin' })
@Controller('admin')
export class AdminController {
  constructor(
    private readonly thresholds: ThresholdsService,
    private readonly vitalTypes: VitalTypesService,
  ) {}

  @Get('alert-thresholds')
  @ApiOperation({ summary: 'List alert limits', description: 'Current versions only.' })
  @ApiOkResponse({ type: ThresholdListResponse })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - unknown type or patient' })
  async listThresholds(@Query() query: ThresholdsQueryDto): Promise<ThresholdListResponse> {
    return this.thresholds.list(query);
  }

  @Put('alert-thresholds/:type')
  @ApiOperation({
    summary: 'Set an alert limit, globally or for one patient',
    description:
      'Each save creates a new version with effectiveFrom set to now; earlier versions are ' +
      'kept, and it applies to saves from then on.',
  })
  @ApiOkResponse({ description: 'The new version of the limit.' })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - unknown type or patient' })
  async setThreshold(
    @CurrentUser() admin: AuthUser,
    @Param('type') type: string,
    @Body() body: SetThresholdDto,
  ): Promise<ThresholdResponse> {
    return this.thresholds.set(type, body, admin);
  }

  @Put('vital-types/:type')
  @ApiOperation({
    summary: "Change a parameter's unit or valid range",
    description:
      'type and valueKind cannot change. The version increases by 1. Values already logged are ' +
      'not re-checked and keep the unit they were saved with.',
  })
  @ApiOkResponse({ type: VitalTypeResponse })
  @ApiBadRequestResponse({ description: 'VALIDATION_FAILED' })
  @ApiNotFoundResponse({ description: 'NOT_FOUND - unknown type' })
  async updateVitalType(
    @CurrentUser() admin: AuthUser,
    @Param('type') type: string,
    @Body() body: UpdateVitalTypeDto,
  ): Promise<VitalTypeResponse> {
    return this.vitalTypes.update(type, body, admin);
  }
}
