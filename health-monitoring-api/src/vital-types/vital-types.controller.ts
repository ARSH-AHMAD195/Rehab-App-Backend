import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { VitalTypesService } from './vital-types.service';
import { VitalTypeResponse } from './vital-type.response';

class VitalTypeListResponse {
  data!: VitalTypeResponse[];
}

@ApiTags('Parameters')
@ApiBearerAuth()
@Controller('vital-types')
export class VitalTypesController {
  constructor(private readonly vitalTypes: VitalTypesService) {}

  /** GET /vital-types - any role. The app builds the form from this list. */
  @Get()
  @ApiOperation({
    summary: 'Parameters, units and valid ranges, to build the form',
    description:
      'v1.1 GET /vital-types. The ranges are data-entry limits an admin can change, not ' +
      'clinical limits - alerting is decided separately by the thresholds.',
  })
  @ApiOkResponse({ type: VitalTypeListResponse })
  @ApiUnauthorizedResponse({ description: 'UNAUTHENTICATED' })
  async list(): Promise<VitalTypeListResponse> {
    return { data: await this.vitalTypes.listResponse() };
  }
}
