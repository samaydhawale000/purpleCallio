import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { AdminService } from './admin.service';
import { AdminGuard } from './guards/admin.guard';

@UseGuards(AdminGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('overview')
  getOverview() {
    return this.adminService.getOverview();
  }

  @Get('customers')
  getCustomers(@Query('page') page?: string) {
    return this.adminService.getCustomers(page);
  }

  @Patch('customers/:id/status')
  updateCustomerStatus(
    @Param('id') id: string,
    @Body() body: { status: 'ACTIVE' | 'SUSPENDED' },
  ) {
    return this.adminService.updateCustomerStatus(id, body.status);
  }

  @Get('customers/:id')
  getCustomer(@Param('id') id: string) {
    return this.adminService.getCustomer(id);
  }

  @Get('customers/:id/discount')
  getCustomerDiscount(@Param('id') id: string) {
    return this.adminService.getCustomerDiscount(id);
  }

  @Post('customers/:id/discount')
  setCustomerDiscount(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    body: {
      percentage: number;
      effectiveFrom: string;
      effectiveUntil?: string | null;
      reason?: string | null;
    },
  ) {
    return this.adminService.setCustomerDiscount(id, req.user.userId, {
      percentage: body.percentage,
      effectiveFrom: new Date(body.effectiveFrom),
      effectiveUntil: body.effectiveUntil ? new Date(body.effectiveUntil) : null,
      reason: body.reason ?? null,
    });
  }

  @Patch('customers/:id/discount/disable')
  disableCustomerDiscount(@Param('id') id: string, @Req() req: any) {
    return this.adminService.disableCustomerDiscount(id, req.user.userId);
  }

  @Get('calls')
  getLiveCalls(@Query('page') page?: string) {
    return this.adminService.getLiveCalls(page);
  }

  @Patch('calls/:id/end')
  endCall(@Param('id') id: string) {
    return this.adminService.endCall(id);
  }

  @Get('usage')
  getUsage() {
    return this.adminService.getUsage();
  }

  @Get('health')
  getHealth() {
    return this.adminService.getHealth();
  }

  @Get('monitoring')
  getMonitoring() {
    return this.adminService.getMonitoring();
  }

  @Get('alerts')
  getAlerts() {
    return this.adminService.getAlerts();
  }

  @Get('audit-logs')
  getAuditLogs(@Query('page') page?: string) {
    return this.adminService.getAuditLogs(page);
  }

  @Get('settings')
  getSettings() {
    return this.adminService.getSettings();
  }

  @Patch('settings')
  updateSettings(@Body() body: any) {
    return this.adminService.updateSettings(body);
  }
}
