import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { XmlDocument } from "@/core/project-format";
import { projectFromXml } from "@/gateway-families/knx-mbm";
import { SYNTHETIC_KNX_MBM_XML } from "@/gateway-families/knx-mbm/fixtures/synthetic-project";
import { parseDeviceTemplate } from "@/server/device-templates/read";
import { TEMPLATE_XML } from "@/server/device-templates/fixtures";
import { DeviceTemplateModal } from "./device-template-modal";

const mocks = vi.hoisted(() => ({ request:vi.fn(),save:vi.fn(),pushUndo:vi.fn(),download:vi.fn(),revision:3 }));
vi.mock("@/lib/api",() => ({request:mocks.request}));
vi.mock("@/lib/device-templates",() => ({downloadDeviceTemplate:mocks.download}));
vi.mock("@/lib/use-save",() => ({useSave:() => ({save:mocks.save,busy:false,error:null})}));
vi.mock("@/lib/workspace-chrome",() => ({useWorkspaceChrome:() => ({pushUndo:mocks.pushUndo})}));
vi.mock("@/lib/current-project",() => ({useCurrentProject:() => ({projectId:"p",view:{family:"knx-mbm",meta:{id:"p",revision:mocks.revision},project:projectFromXml(XmlDocument.parse(SYNTHETIC_KNX_MBM_XML))}})}));
const preview = () => ({...parseDeviceTemplate(TEMPLATE_XML).preview,token:"test-token",revision:3,fileName:"real.knxmbm"});
const library = {manufacturers:["Maker"],entries:[{id:"first",manufacturer:"Maker",model:"AHU",version:"1",modelVersion:"1",manufacturerSlug:"maker",protocol:"knx"}]};
beforeEach(() => {
  vi.clearAllMocks(); mocks.revision=3;
  mocks.request.mockImplementation(async (url:string) => url === "/api/modbus-templates" ? library : preview());
  mocks.save.mockResolvedValue(true);
});

async function loadFile() {
  fireEvent.change(screen.getByLabelText("Template file"),{target:{files:[new File(["encrypted"],"real.knxmbm")]}});
  await screen.findByText("Temperature & demand");
}

describe("device template preview", () => {
  it("shows real values, applies disabled selection and destination in one patch, and offers one undo", async () => {
    const closed = vi.fn(); render(<DeviceTemplateModal initialLocator={{kind:"rtu",nodeIndex:0}} onClose={closed}/>);
    await loadFile();
    expect(screen.getByText("9.001")).toBeInTheDocument();
    expect(screen.getByText("0/0/102")).toBeInTheDocument();
    expect(screen.getByText("17")).toBeInTheDocument();
    expect(screen.getByText("32")).toBeInTheDocument();
    expect(screen.getByLabelText("Slave number")).toHaveValue("2");
    expect(screen.getByLabelText("Activate object 2")).not.toBeChecked();
    fireEvent.click(screen.getByLabelText("Import disabled objects"));
    fireEvent.click(screen.getByRole("button",{name:"Add device"}));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith([{type:"applyDeviceTemplate",token:"test-token",locator:{kind:"rtu",nodeIndex:0},name:"Synthetic AHU",slave:2,enabled:[0],includeDisabled:true}]));
    expect(mocks.pushUndo).toHaveBeenCalledWith({label:"Imported Synthetic AHU",patches:[{type:"undoDeviceTemplate",token:"test-token"}]});
    expect(closed).toHaveBeenCalled();
  });

  it("blocks duplicate slaves and stale previews", async () => {
    const {rerender} = render(<DeviceTemplateModal initialLocator={{kind:"rtu",nodeIndex:0}} onClose={vi.fn()}/>);
    await loadFile();
    fireEvent.change(screen.getByLabelText("Slave number"),{target:{value:"1"}});
    expect(screen.getByRole("button",{name:"Add device"})).toBeDisabled();
    expect(screen.getByText(/Slave number is already used/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Slave number"),{target:{value:"2"}});
    mocks.revision=4;
    rerender(<DeviceTemplateModal initialLocator={{kind:"rtu",nodeIndex:0}} onClose={vi.fn()}/>);
    expect(screen.getByRole("button",{name:"Add device"})).toBeDisabled();
    expect(screen.getByText(/The project changed/)).toBeInTheDocument();
  });

  it("downloads the selected official binary and loads it through the same preview endpoint", async () => {
    render(<DeviceTemplateModal initialLocator={{kind:"rtu",nodeIndex:0}} onClose={vi.fn()}/>);
    fireEvent.click(screen.getByRole("button",{name:"Download templates"}));
    await screen.findByRole("radio");
    fireEvent.click(screen.getByRole("radio"));
    fireEvent.click(screen.getByRole("button",{name:"Download template"}));
    await waitFor(() => expect(mocks.download).toHaveBeenCalledWith("/api/modbus-templates/first/download","Maker - AHU.knxmbm"));
    await waitFor(() => expect(screen.getByRole("button",{name:"Load template"})).toBeEnabled());
    fireEvent.click(screen.getByRole("button",{name:"Load template"}));
    await screen.findByText("Temperature & demand");
    const body = mocks.request.mock.calls.at(-1)![1].body as FormData;
    expect(body.get("libraryId")).toBe("first");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
