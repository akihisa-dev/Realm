import { fireEvent, render, screen } from "@testing-library/react";
import { RegionPanel } from "./RegionPanel";
import { deriveRegionEntries } from "./regionObjects";

const regionId = "11111111-1111-4111-8111-111111111111";
const regions = deriveRegionEntries([
  { cellId: "1:1", attribute: "region", value: "#2468AC", regionId },
  { cellId: "2:1", attribute: "region", value: "#2468AC", regionId },
  { cellId: "20:20", attribute: "region", value: "#2468AC", regionId },
]);

const renderManager = () => {
  const callbacks = {
    onSelectRegion: vi.fn(),
    onSelectComponent: vi.fn(),
    onStartNewRegion: vi.fn(),
    onAddToRegion: vi.fn(),
    onSplitComponent: vi.fn(),
    onClose: vi.fn(),
  };
  render(<RegionPanel regions={regions} selectedRegionIds={[]} selectedComponentId={null} regionPaintTargetId={null} {...callbacks} />);
  return callbacks;
};

describe("RegionPanel", () => {
  it("shows the logical region and its disconnected chunks", () => {
    const callbacks = renderManager();

    expect(screen.getByRole("region", { name: "領域レイヤー管理" })).toBeInTheDocument();
    expect(screen.getByText("2個の塊・3セル")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "領域 1の塊を表示する" }));
    expect(screen.getByRole("button", { name: "領域 1の塊1を分離" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "領域 1の塊2を分離" })).toBeInTheDocument();

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "選択した領域を統合" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /領域 1 2個の塊・3セル/ }));
    expect(callbacks.onSelectRegion).toHaveBeenCalledWith(regions[0]);
    fireEvent.click(screen.getByRole("button", { name: "領域 1に領域を追加" }));
    expect(callbacks.onAddToRegion).toHaveBeenCalledWith(regions[0]);
  });

  it("disables every region selection control while editing is locked", () => {
    render(<RegionPanel regions={regions} selectedRegionIds={[]} selectedComponentId={null} regionPaintTargetId={null} disabled onSelectRegion={vi.fn()} onSelectComponent={vi.fn()} onStartNewRegion={vi.fn()} onAddToRegion={vi.fn()} onSplitComponent={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole("button", { name: /領域 1 2個の塊・3セル/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "領域 1の塊を表示する" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "新しい領域" })).toBeDisabled();
  });
});
